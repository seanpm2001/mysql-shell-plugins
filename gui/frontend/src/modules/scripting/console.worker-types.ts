/*
 * Copyright (c) 2020, 2022, Oracle and/or its affiliates.
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

import { IDictionary } from "../../app-logic/Types";
import { IPieGraphLayout, IPieGraphDataPoint, IResultSetRow } from "../../components/ResultView/graphs/PieGraphImpl";

// Define an own worker type to allow adding some private functionality.
// However, Safari doesn't support the Worker type in worker code, so we have to repeat some definitions.
export class PrivateWorker /*extends Worker*/ {
    public currentContext?: string;
    public currentTaskId?: number;
    public pendingRequests: Map<string, (res: unknown) => void>;

    public postContextMessage: (taskId: number, message: IConsoleWorkerResultData) => void;

    // Functions from Worker.
    public postMessage: (data: unknown, origin?: string) => void;
    public addEventListener: (message: string, callback: (event: MessageEvent) => void) => void;
}

// API ids used in the communication between the scripting tab and its worker instance.
// See also console.worker.ts.
export enum ScriptingApi {
    Request,         // Set when sending a task to a worker.
    QueryStatus,     // A status message without a result.
    Result,          // A full result + status.
    RunSqlIterative, // To execute an SQL statement.
    RunSql,          // To execute an SQL statement and fetch a complete result set.
    Print,           // To print something from the user.
    QueryType,       // Determine the type of a query.

    // Various graph result types.
    PieGraphCreate,
    PieGraphAddPoints,

    // A special "API" to denote that everything is done in the console worker and the task can be removed.
    Done,
}

export interface IConsoleWorkerTaskData {
    api: ScriptingApi;
    contextId?: string;

    code?: string;
    params?: unknown;
    result?: unknown;
    final?: boolean;
}

// TODO: make this union type for different APIs.
export interface IConsoleWorkerResultData extends IDictionary {
    api: ScriptingApi;
    contextId: string;
    final?: boolean;   // True if this result is the last data block for the task.

    code?: string;
    params?: unknown;

    // Various result fields, depending on the executed API.
    result?: unknown;
    isError?: boolean;
    content?: unknown;
    value?: unknown;

    // Graphs
    graphLayout?: IPieGraphLayout;
    graphData?: IPieGraphDataPoint[] | IResultSetRow[];
}

