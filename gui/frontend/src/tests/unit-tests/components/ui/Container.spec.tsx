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

import connection from "../../../../assets/images/connections.svg";

import React from "react";
import { Container, Orientation, Icon, Button } from "../../../../components/ui";
import { snapshotFromWrapper } from "../../test-helpers";
import { mount } from "enzyme";

describe("Container component tests", (): void => {

    it("Test Container output (snapshot)", () => {
        const component = mount<Container>(
            <Container className="demoContainer">
                <Container
                    orientation={Orientation.TopDown}
                    style={{ margin: "20px" }}
                >
                    <Icon src={connection} />
                    <Icon src={connection} />
                    <Icon src={connection} />
                    <Icon src={connection} />
                    <Icon src={connection} />
                    <Icon src={connection} />
                </Container>
                <Container
                    orientation={Orientation.BottomUp}
                    style={{ margin: "20px" }}
                >
                    <Button round>M</Button>
                    <Button round>M</Button>
                    <Button round>M</Button>
                    <Button round>M</Button>
                    <Button round>M</Button>
                </Container>
            </Container>,
        );
        expect(snapshotFromWrapper(component)).toMatchSnapshot();
    });

});
