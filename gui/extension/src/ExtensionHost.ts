/*
 * Copyright (c) 2021, 2022, Oracle and/or its affiliates.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License, version 2.0,
 * as published by the Free Software Foundation.
 *
 * This program is also distributed with certain software (including
 * but not limited to OpenSSL) that is licensed under separate terms, as
 * designated in a particular file or component or in included license
 * documentation.  The authors of MySQL hereby grant you an additional
 * permission to link the program and your derivative works with the
 * separately licensed software that they have included with MySQL.
 * This program is distributed in the hope that it will be useful,  but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See
 * the GNU General Public License, version 2.0, for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin St, Fifth Floor, Boston, MA 02110-1301 USA
 */

import {
    commands, ExtensionContext, window, workspace, ConfigurationChangeEvent, WorkspaceConfiguration,
} from "vscode";

import { isNil } from "lodash";

import {
    ICommAuthenticationEvent, ICommErrorEvent, ICommListDataCategoriesEvent, ICommListProfilesEvent, ICommShellProfile,
    ICommWebSessionEvent, IShellModuleDataCategoriesEntry,
} from "../../frontend/src/communication";

import { eventFilterNoRequests, ListenerEntry } from "../../frontend/src/supplement/Dispatch";
import { ShellInterface } from "../../frontend/src/supplement/ShellInterface";
import { webSession } from "../../frontend/src/supplement/WebSession";
import { ISettingCategory, settingCategories } from "../../frontend/src/supplement/Settings/SettingsRegistry";
import { settings } from "../../frontend/src/supplement/Settings/Settings";
import { ShellTask } from "../../frontend/src/shell-tasks/ShellTask";

import { ShellConsolesTreeDataProvider } from "./tree-providers/ShellTreeProvider/ShellConsolesTreeProvider";
import { ScriptsTreeDataProvider } from "./tree-providers/ScriptsTreeProvider";
import { SchemaMySQLTreeItem } from "./tree-providers/ConnectionsTreeProvider/SchemaMySQLTreeItem";
import { ShellTasksTreeDataProvider } from "./tree-providers/ShellTreeProvider/ShellTasksTreeProvider";
import { taskOutputChannel } from "./extension";
import { ConnectionMySQLTreeItem } from "./tree-providers/ConnectionsTreeProvider/ConnectionMySQLTreeItem";

import { DbEditorCommandHandler } from "./DbEditorCommandHandler";
import { ShellConsoleCommandHandler } from "./ShellConsoleCommandHandler";
import { requisitions } from "../../frontend/src/supplement/Requisitions";
import { MDSCommandHandler } from "./MDSCommandHandler";
import { MRSCommandHandler } from "./MRSCommandHandler";

// This class manages some extension wide things like authentication handling etc.
export class ExtensionHost {
    private activeProfile?: ICommShellProfile;

    private dbEditorCommandHandler = new DbEditorCommandHandler();
    private shellConsoleCommandHandler = new ShellConsoleCommandHandler();
    private mrsCommandHandler = new MRSCommandHandler();
    private mdsCommandHandler = new MDSCommandHandler();

    // Tree data providers for the extension's sidebar. The connection provider is managed in the DB editor
    // command handler.
    private scriptsTreeDataProvider: ScriptsTreeDataProvider;
    private consoleTreeDataProvider: ShellConsolesTreeDataProvider;
    private shellTasksTreeDataProvider: ShellTasksTreeDataProvider;

    // List of shell tasks
    private shellTasks: ShellTask[] = [];

    // A mapping from data type captions to data type ids.
    private moduleDataCategories = new Map<string, IShellModuleDataCategoriesEntry>();

    // Listeners.
    private serverResponse: ListenerEntry;
    private webSession: ListenerEntry;

    public constructor(private context: ExtensionContext) {
        this.setupEnvironment();

        requisitions.register("settingsChanged", this.updateVscodeSettings);

        this.serverResponse = ListenerEntry.createByClass("serverResponse", { persistent: true });
        this.serverResponse.catch((errorEvent: ICommErrorEvent) => {
            void window.showErrorMessage("Backend Error: " + (errorEvent.message ?? "Unknown error"));
        });

        this.webSession = ListenerEntry.createByClass("webSession",
            { filters: [eventFilterNoRequests], persistent: true });
        this.webSession.then((event: ICommWebSessionEvent) => {
            if (event.data?.sessionUuid) {
                webSession.sessionId = event.data.sessionUuid;
                webSession.localUserMode = event.data.localUserMode;
            }

            if (webSession.userName === "") {
                if (event.data?.localUserMode) {
                    ShellInterface.users.authenticate("LocalAdministrator", "")
                        .then((authEvent: ICommAuthenticationEvent) => {
                            this.onAuthentication(authEvent);
                        });
                }
            } else if (event.data) {
                webSession.loadProfile(event.data.activeProfile);
                this.activeProfile = event.data.activeProfile;
            }
        });
    }

    /**
     * Closes all webview tabs and frees their providers.
     */
    public closeAllTabs(): void {
        this.dbEditorCommandHandler.closeProviders();
        this.shellConsoleCommandHandler.closeProviders();
    }

    public addNewShellTask(caption: string, shellArgs: string[], dbConnectionId?: number): Promise<unknown> {
        const task = new ShellTask(caption, this.taskPromptCallback, this.taskMessageCallback);
        this.shellTasks.push(task);
        this.shellTasksTreeDataProvider.refresh();

        taskOutputChannel.show();

        return task.runTask(shellArgs, dbConnectionId).then(() => {
            this.shellTasksTreeDataProvider.refresh();
        });
    }

    /**
     * Prepares all vscode providers for first use.
     */
    private setupEnvironment(): void {
        this.dbEditorCommandHandler.setup(this.context);
        this.shellConsoleCommandHandler.setup(this.context);
        this.mrsCommandHandler.setup(this.context, this);
        this.mdsCommandHandler.setup(this.context, this);

        const updateLogLevel = (): void => {
            const configuration = workspace.getConfiguration(`msg.debugLog`);
            const level = configuration.get<string>("level", "INFO");

            void ShellInterface.core.setLogLevel(level).catch((error) => {
                void window.showErrorMessage("Error while setting log level: " + String(error));
            });
        };
        updateLogLevel();

        this.context.subscriptions.push(workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
            if (event.affectsConfiguration("msg")) {
                updateLogLevel();
                this.updateProfileSettings();
            }
        }));

        // Our tree providers.
        this.consoleTreeDataProvider = new ShellConsolesTreeDataProvider();
        this.context.subscriptions.push(window.registerTreeDataProvider("msg.consoles", this.consoleTreeDataProvider));

        this.shellTasksTreeDataProvider = new ShellTasksTreeDataProvider(this.shellTasks);
        this.context.subscriptions.push(window.registerTreeDataProvider("msg.shellTasks",
            this.shellTasksTreeDataProvider));

        // The scripts provider needs a module data category id and is created later, when this info is available.

        // Handling of extension commands.
        this.context.subscriptions.push(commands.registerCommand("msg.selectProfile", () => {
            this.selectProfile();
        }));

        this.context.subscriptions.push(commands.registerCommand("msg.dumpSchemaToDisk",
            (item?: SchemaMySQLTreeItem) => {
                if (item) {
                    void window.showOpenDialog({
                        title: "Select an output folder for the dump.",
                        openLabel: "Select Dump Folder",
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                    }).then((targetUri) => {
                        if (targetUri && targetUri.length === 1) {
                            const shellArgs = [
                                "--",
                                "util",
                                "dump-schemas",
                                item.schema,
                                "--outputUrl",
                                targetUri[0].fsPath,
                            ];

                            void this.addNewShellTask(`Dump Schema ${item.schema} to Disk`, shellArgs,
                                item.entry.details.id)
                                .then(() => {
                                    this.shellTasksTreeDataProvider.refresh();
                                });
                        }
                    });
                }
            }));

        this.context.subscriptions.push(commands.registerCommand("msg.dumpSchemaToDiskForMds",
            (item?: SchemaMySQLTreeItem) => {
                if (item) {
                    void window.showOpenDialog({
                        title: "Select an output folder for the dump.",
                        openLabel: "Select Dump Folder",
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                    }).then((targetUri) => {
                        if (targetUri && targetUri.length === 1) {
                            const shellArgs = [
                                "--",
                                "util",
                                "dump-schemas",
                                item.schema,
                                "--outputUrl",
                                targetUri[0].fsPath,
                                "--ocimds",
                                "true",
                                "--compatibility",
                                "create_invisible_pks,force_innodb,skip_invalid_accounts," +
                                "strip_definers,strip_restricted_grants,strip_tablespaces",
                            ];

                            void this.addNewShellTask(`Dump Schema ${item.schema} to Disk`, shellArgs,
                                item.entry.details.id)
                                .then(() => {
                                    this.shellTasksTreeDataProvider.refresh();
                                });
                        }
                    });
                }
            }));

        this.context.subscriptions.push(commands.registerCommand("msg.loadDumpFromDisk",
            (item?: ConnectionMySQLTreeItem) => {
                if (item) {
                    void window.showOpenDialog({
                        title: "Select a folder that contains a MySQL Shell dump.",
                        openLabel: "Select Dump Folder",
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                    }).then((targetUri) => {
                        if (targetUri && targetUri.length === 1) {
                            const shellArgs = [
                                "--",
                                "util",
                                "load-dump",
                                targetUri[0].fsPath,
                            ];

                            let folderName = "";
                            const m = targetUri[0].fsPath.match(/([^/]*)\/*$/);
                            if (m && m.length > 1) {
                                folderName = m[1] + " ";
                            }

                            void this.addNewShellTask(`Loading Dump ${folderName}from Disk`, shellArgs,
                                item.entry.details.id)
                                .then(() => {
                                    this.shellTasksTreeDataProvider.refresh();
                                    void commands.executeCommand("msg.refreshConnections");
                                });
                        }
                    });
                }
            }));
    }

    private onAuthentication(event: ICommAuthenticationEvent): void {
        this.activeProfile = event.data?.activeProfile;
        ShellInterface.modules.listDataCategories().then((list: ICommListDataCategoriesEvent) => {
            list.data?.result.forEach((row) => {
                this.moduleDataCategories.set(row.name, row);
            });

            // TODO: Finish the SCRIPT tree,
            // leave the current implementation commented out for now on purpose
            /*if (!this.scriptsTreeDataProvider) {
                const category = this.moduleDataCategories.get("Script");
                if (category) {
                    this.scriptsTreeDataProvider = new ScriptsTreeDataProvider(category.id);
                    this.context.subscriptions.push(window.registerTreeDataProvider("msg.scripts",
                        this.scriptsTreeDataProvider));
                }
            } else {
                this.scriptsTreeDataProvider.refresh();
            }*/

            // Refresh relevant tree providers.
            this.dbEditorCommandHandler.refreshConnectionTree();
            this.consoleTreeDataProvider.refresh([]);

            void commands.executeCommand("msg.mds.refreshOciProfiles");
        });

    }

    /**
     * Triggered when the user changed a vscode setting. Updates the current profile.
     */
    private updateProfileSettings(): void {

        const updateFromChildren = (children?: ISettingCategory[], configuration?: WorkspaceConfiguration): void => {
            children?.forEach((child) => {
                child.values.forEach((value) => {
                    const configValue = configuration?.get(`${child.key}.${value.key}`);
                    if (!isNil(configValue)) {
                        settings.set(value.id, configValue);
                    }
                });

                updateFromChildren(child.children, configuration);
            });
        };

        const categories = settingCategories.children;
        if (categories) {
            categories.forEach((category) => {
                const configuration = workspace.getConfiguration(`msg.${category.key}`);
                category.values.forEach((value) => {
                    const configValue = configuration.get(value.key);
                    if (!isNil(configValue)) {
                        settings.set(value.id, configValue);
                    }
                });

                updateFromChildren(category.children, configuration);
            });
        }

        settings.saveSettings();
    }

    /**
     * The other way around for settings. When the profile changes, change also VS code settings.
     *
     * @param entry The entry that changed or undefined when all values must be set.
     * @param entry.key The key of the value to change.
     * @param entry.value The value to set.
     *
     * @returns A promise resolving to true.
     */
    private updateVscodeSettings = (entry?: { key: string; value: unknown }): Promise<boolean> => {
        return new Promise((resolve) => {
            if (entry) {
                const parts = entry.key.split(".");
                if (parts.length === 3) {
                    const configuration = workspace.getConfiguration(`msg.${parts[0]}`);
                    void configuration.update(`${parts[1]}.${parts[2]}`, entry.value, true).then(() => {
                        resolve(true);
                    });
                }
            } else {
                const categories = settingCategories.children;
                if (categories) {
                    const updateFromChildren = (children?: ISettingCategory[],
                        configuration?: WorkspaceConfiguration): void => {
                        children?.forEach((child) => {
                            child.values.forEach((value) => {
                                const setting = settings.get(value.id);
                                void configuration?.update(`${child.key}.${value.key}`, setting, true);
                            });

                            updateFromChildren(child.children, configuration);
                        });
                    };


                    categories.forEach((category) => {
                        if (category.key !== "theming") {
                            const configuration = workspace.getConfiguration(`msg.${category.key}`);
                            category.values.forEach((value) => {
                                const setting = settings.get(value.id);
                                void configuration.update(value.key, setting, true);
                            });

                            updateFromChildren(category.children, configuration);
                        }
                    });
                }

            }
        });
    };

    private selectProfile(): void {
        if (this.activeProfile) {
            ShellInterface.users.listProfiles(this.activeProfile.userId).then((event: ICommListProfilesEvent) => {
                if (event.data?.rows) {
                    const items = event.data.rows.map((value) => {
                        return value.name;
                    });

                    void window.showQuickPick(items, {
                        title: "Activate a Profile",
                        matchOnDescription: true,
                        placeHolder: "Type the name of an existing profile",
                    }).then((name) => {
                        if (name && event.data?.rows) {
                            const row = event.data.rows.find((candidate) => { return candidate.name === name; });
                            if (row) {
                                ShellInterface.users.setCurrentProfile(row.id).then(() => {
                                    window.setStatusBarMessage("Profile set successfully", 5000);
                                });
                            }
                        }
                    });
                }
            });
        }
    }

    private taskPromptCallback = (text: string, isPassword: boolean): Promise<string | undefined> => {
        return new Promise((resolve) => {
            // Check if the text ends with "[yes/NO/...]: ".
            const match = text.match(/\[([\w\d\s/]+)\]:\s*?$/);
            if (match && match.length === 2 && match.index) {
                const buttons = match[1].split("/");

                // Ensure first char is uppercase.
                for (let i = 0; i < buttons.length; i++) {
                    buttons[i] = buttons[i].charAt(0).toUpperCase() + buttons[i].slice(1);
                }

                void window.showInformationMessage(text.substring(0, match.index) + "?", ...buttons).then((value) => {
                    resolve(value);
                });
            } else {
                void window.showInputBox({ title: text, password: isPassword }).then((value) => {
                    resolve(value);
                });
            }
        });
    };

    private taskMessageCallback = (message: unknown): void => {
        if (typeof message === "string") {
            taskOutputChannel.append(message);
        } else {
            taskOutputChannel.append(JSON.stringify(message));
        }
    };

}
