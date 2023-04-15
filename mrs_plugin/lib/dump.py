# Copyright (c) 2022, 2023, Oracle and/or its affiliates.
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

from mrs_plugin import lib
from mrs_plugin.lib import core, db_objects


def get_object_fields(session, id):
    return lib.core.select('field', where=['db_object_id=?'],
                           binary_formatter=lambda x: f"0x{x.hex()}").exec(
        session, params=[id]).items


def cleanup_object(target_object, additional_fields=[]):
    'Removes attributes from an object if they are None'
    delete_fields_if_none = ['sdk_options', 'comments']
    delete_fields_if_none = delete_fields_if_none + additional_fields

    for field in delete_fields_if_none:
        if field in target_object and target_object[field] is None:
            del target_object[field]


def reformat_field(field):
    """Formats a field entry so it matches the field definition used in
       set_object_fields_with_references'"""

    # Trims the ' - ' prefix from the caption
    field['caption'] = field['caption'].split('-')[1][1:]

    # Removes fields not used in input
    delete_fields = ['caption', 'lev']
    for name in delete_fields:
        del field[name]

    # Removes fields if they are None in field
    cleanup_object(field, ['represents_reference_id', 'parent_reference_id'])

    # Deletes the object reference when it is not really an object reference
    object_reference = field['object_reference']
    all_null = True
    for key, val in object_reference.items():
        if val is not None:
            all_null = False

    if all_null:
        del field['object_reference']
    else:
        # Renames object_reference fields to camel_case to match the input format
        # TODO(someone): This is needed because the object_fields_with_reference view
        # creates the fields for the object_reference in camelCase, while the input
        # format uses snake_case, so one of 2 things should be fixed:
        # - The original input format to use camelCase
        # - The view, to use snake_case
        rename_items = {
            'sdkOptions': 'sdk_options',
            'reduceToValueOfFieldId': 'reduce_to_value_of_field_id',
            'crudOperations': 'crud_operations',
            'referenceMapping': 'reference_mapping'
        }

        for cc_field, sc_field in rename_items.items():
            if cc_field in object_reference:
                object_reference[sc_field] = object_reference[cc_field]
                del object_reference[cc_field]

        # Removes fields if they are None in object_reference
        cleanup_object(object_reference, ['reduce_to_value_of_field_id'])

        # Since this field is created with JSON_OBJECT, the real value will be like
        # "base64:type254:JK3dckeLTDXGOxo7EWxzJA=="}
        # We need to port that to the format used for dumps: hex
        if 'reduce_to_value_of_field_id' in object_reference:
            id = object_reference['reduce_to_value_of_field_id']
            binary_id = lib.core.id_to_binary(
                id.split(':')[-1], 'reduce_to_value_of_field_id')
            hex_id = lib.core.convert_id_to_string(binary_id)
            object_reference['reduce_to_value_of_field_id'] = hex_id

        # Inserts the reference object id
        object_reference['id'] = field['represents_reference_id']


def get_object_dump(session, id):
    'Gets a dump of the objects associated to a db_object'
    objects = lib.core.select('object', where=['db_object_id=?'],
                              binary_formatter=lambda x: f"0x{x.hex()}").exec(
        session, params=[id]).items

    for obj in objects:
        # Removes fields if they are None in object
        cleanup_object(obj)
        id = core.id_to_binary(obj['id'], 'object.id')
        obj['fields'] = db_objects.get_object_fields_with_references(session,
                                                                     id,
                                                                     binary_formatter=lambda x: f"0x{x.hex()}")

        for field in obj['fields']:
            reformat_field(field)

    return objects


def get_db_object_dump(session, id):
    'Gets a dump for a db_object'
    obj = lib.core.select('db_object', where=['id=?'],
                          binary_formatter=lambda x: f"0x{x.hex()}").exec(
        session, params=[id]).first

    obj["fields"] = get_object_fields(session, id)

    # A db_object may have one or more associated objects (from the object table)
    obj["objects"] = get_object_dump(session, id)

    return obj


def get_db_schema_dump(session, id):
    schema = lib.core.select('db_schema', where=['id=?'],
                             binary_formatter=lambda x: f"0x{x.hex()}").exec(
        session, params=[id]).first

    schema["objects"] = []

    objects = lib.core.select('db_object', cols=['id'], where=['db_schema_id=?']).exec(
        session, params=[id]).items

    schema["objects"] = [get_db_object_dump(
        session, object['id']) for object in objects]

    return schema


def get_service_dump(session, id):
    service = lib.core.select('service', where=['id=?'],
                              binary_formatter=lambda x: f"0x{x.hex()}").exec(
        session, params=[id]).first

    service["schemas"] = []

    schemas = lib.core.select('db_schema', cols=['id'], where=['service_id=?']).exec(
        session, params=[id]).items

    service["schemas"] = [get_db_schema_dump(
        session, schema['id']) for schema in schemas]

    return service


def load_object_dump(session, target_schema_id, object, reuse_ids):
    db_object_id = None
    if reuse_ids:
        db_object_id = lib.core.id_to_binary(object["id"], "object.id")

    lib.db_objects.add_db_object(session, target_schema_id,
                                 object["name"],
                                 object["request_path"],
                                 object["object_type"],
                                 object["enabled"],
                                 object["items_per_page"],
                                 object["requires_auth"],
                                 object["row_user_ownership_enforced"],
                                 object["row_user_ownership_column"],
                                 object["crud_operations"],
                                 object["format"],
                                 object["comments"],
                                 object["media_type"],
                                 object["auto_detect_media_type"],
                                 object["auth_stored_procedure"],
                                 object["options"],
                                 object["fields"],
                                 db_object_id=db_object_id,
                                 reuse_ids=reuse_ids)  # object.fields)

    # TODO(someone): This loop is because in theory, a db_object may have several objects,
    # however, right now only 1 is supported because set_object_fields_with_references
    # drops all the objects associated to the db_object at the beginning
    if 'objects' in object:
        for inner_object in object['objects']:
            lib.db_objects.set_object_fields_with_references(
                session, inner_object)


def load_schema_dump(session, target_service_id, schema, reuse_ids):
    schema_id = None
    if reuse_ids:
        schema_id = lib.core.id_to_binary(schema["id"], "object.id")

    schema_id = lib.schemas.add_schema(session,
                                       schema["name"],
                                       target_service_id,
                                       schema["request_path"],
                                       schema["requires_auth"],
                                       schema["enabled"],
                                       schema["items_per_page"],
                                       schema["comments"],
                                       schema["options"],
                                       schema_id=schema_id)

    for obj in schema["objects"]:
        load_object_dump(session, schema_id, obj, reuse_ids)

    return schema_id
