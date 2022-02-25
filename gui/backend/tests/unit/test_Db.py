# Copyright (c) 2020, 2022, Oracle and/or its affiliates.
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License, version 2.0,
# as published by the Free Software Foundation.
#
# This program is also distributed with certain software (including
# but not limited to OpenSSL) that is licensed under separate terms, as
# designated in a particular file or component or in included license
# documentation.  The authors of MySQL hereby grant you an additional
# permission to link the program and your derivative works with the
# separately licensed software that they have included with MySQL.
# This program is distributed in the hope that it will be useful,  but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See
# the GNU General Public License, version 2.0, for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software Foundation, Inc.,
# 51 Franklin St, Fifth Floor, Boston, MA 02110-1301 USA

import shutil
from gui_plugin.core.Db import GuiBackendDb, BackendSqliteDbManager, convert_workbench_sql_file_to_sqlite, convert_all_workbench_sql_files_to_sqlite
from gui_plugin.core.GuiBackendDbManager import latest_db_version
from gui_plugin.core.lib.Version import Version
import datetime
import os
import sqlite3
import tempfile
import pytest


def test_GuiBackendDb_init():
    backend_db = GuiBackendDb()
    backend_db.select("SELECT * FROM log")

    backend_db2 = GuiBackendDb()
    backend_db2.select("SELECT * FROM log")


def test_GuiBackendDb_commit():
    backend_db = GuiBackendDb()

    result = backend_db.execute('''SELECT COUNT(*) FROM log''').fetch_one()
    count_step_1 = result[0]

    backend_db.start_transaction()
    backend_db.execute('''INSERT INTO log(event_time, event_type,
            message) VALUES(?, ?, ?)''',
                       (datetime.datetime.now(), 'INFO', '__TEST MESSAGE__'))
    id = backend_db.get_last_row_id()
    backend_db.commit()

    result = backend_db.execute('''SELECT COUNT(*) FROM log''').fetch_one()
    count_step_2 = result[0]

    backend_db.start_transaction()
    backend_db.execute('''DELETE FROM log WHERE id=?''', (id,))

    result = backend_db.execute('''SELECT COUNT(*) FROM log''').fetch_one()
    count_step_3 = result[0]

    assert count_step_1 == count_step_2 - 1
    assert count_step_1 == count_step_3


def test_GuiBackendDb_rollback():
    backend_db = GuiBackendDb()

    result = backend_db.execute('''SELECT COUNT(*) FROM log''').fetch_one()
    count_step_1 = result[0]

    backend_db.start_transaction()
    backend_db.execute('''INSERT INTO log(event_time, event_type,
            message) VALUES(?, ?, ?)''',
                       (datetime.datetime.now(), 'INFO', '__TEST MESSAGE__'))
    backend_db.rollback()

    result = backend_db.execute('''SELECT COUNT(*) FROM log''').fetch_one()
    count_step_2 = result[0]

    assert count_step_1 == count_step_2


def test_GuiBackendDb_insert():
    backend_db = GuiBackendDb()

    result = backend_db.execute('''SELECT COUNT(*) FROM log''').fetch_one()
    count_step_1 = result[0]

    backend_db.start_transaction()
    backend_db.insert('''INSERT INTO log(event_time, event_type,
            message) VALUES(?, ?, ?)''',
                      (datetime.datetime.now(), 'INFO', '__TEST MESSAGE__'))
    id = backend_db.get_last_row_id()
    backend_db.commit()

    result = backend_db.execute('''SELECT COUNT(*) FROM log''').fetch_one()
    count_step_2 = result[0]

    backend_db.start_transaction()
    backend_db.execute('''DELETE FROM log WHERE id=?''', (id,))
    backend_db.commit()

    result = backend_db.execute('''SELECT COUNT(*) FROM log''').fetch_one()
    count_step_3 = result[0]

    assert count_step_2 == count_step_1 + 1
    assert count_step_1 == count_step_3


def test_GuiBackendDb_select_json():
    backend_db = GuiBackendDb()

    result = backend_db.select('''SELECT * FROM db_connection''')

    assert len(result) > 0


def test_GuiBackendDb_check_for_previous_version_and_upgrade():
    backend_db = BackendSqliteDbManager()

    result = backend_db.check_for_previous_version_and_upgrade()

    assert result == True


def test_GuiBackendDb_convert_workbench_sql_file_to_sqlite():
    original_file = os.path.join(
        'gui_plugin', 'core', 'db_schema', 'mysqlsh_gui_backend_0.0.2.mysql.sql')
    source_file = os.path.join(
        'gui_plugin', 'core', 'db_schema', 'mysqlsh_gui_backend_0.0.99.test.mysql.sql')
    target_file = os.path.join(
        'gui_plugin', 'core', 'db_schema', 'mysqlsh_gui_backend_0.0.99.test.sqlite.sql')

    if os.path.exists(source_file):
        os.remove(source_file)

    if os.path.exists(target_file):
        os.remove(target_file)

    assert not os.path.exists(source_file)
    assert not os.path.exists(target_file)

    shutil.copyfile(original_file, source_file)

    assert os.path.exists(source_file)

    convert_workbench_sql_file_to_sqlite(source_file)

    assert os.path.exists(target_file)

    if os.path.exists(source_file):
        os.remove(source_file)

    if os.path.exists(target_file):
        os.remove(target_file)


def test_convert_all_workbench_sql_files_to_sqlite():
    convert_all_workbench_sql_files_to_sqlite()

    # TODO: Make verifications here...
    # Verify all files were created
    # Verify that ENGINE is gone
    # Verify that VISIBLE is gone
    # Verify that INT is now INTEGER
    # Verify that START TRANSACTION is now BEGIN TRANSACTION
    # Verify that AFTER is gone
    # Verify that default_schema is gone
    # Verify that DEFAULT CHARACTER SET is gone
    # Verify that DEFAULT NULL is gone


def test_upgrade_db():
    previous_db_version = str(latest_db_version).split(".")
    previous_db_version[2] = str(int(previous_db_version[2])-1)
    previous_db_version = Version(previous_db_version)

    previous_version_script = os.path.join(
        'gui_plugin', 'core', 'db_schema', f'mysqlsh_gui_backend_{previous_db_version}.sqlite.sql')
    upgrade_script = os.path.join(
        'gui_plugin', 'core', 'db_schema', f'mysqlsh_gui_backend_{previous_db_version}_to_{latest_db_version}.sqlite.sql')
    assert os.path.exists(previous_version_script)
    assert os.path.exists(upgrade_script)

    temp_file = f"{tempfile.NamedTemporaryFile().name}.sqlite3"

    conn = sqlite3.connect(temp_file)
    cur = conn.cursor()

    with open(previous_version_script, 'r') as sql_file:
        sql_create = sql_file.read()
    with open(upgrade_script, 'r') as sql_file:
        sql_upgrade = sql_file.read()

    try:
        cur.executescript(sql_create)
        cur.executescript(sql_upgrade)
    except Exception as e:
        pytest.fail(str(e))

    conn.close()

    os.remove(temp_file)
