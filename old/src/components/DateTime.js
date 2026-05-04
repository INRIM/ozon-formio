"use strict";
import moment from "moment";

import DateTimeComponent from 'formiojs/components/datetime/DateTime';


export default class ViewerDateTime extends DateTimeComponent {
    constructor(component, options, data) {
        options.timezone = "Europe/Rome";

        super(component, options, data);
        // Pass along the pdf option to the calendar widget.
        if (!this.component.widget) {
            this.component.widget = {};
        }
        this.component.widget.type = 'viewercalendar';
    }


}

