import CalendarWidget from 'formiojs/widgets/CalendarWidget';
import Widgets from 'formiojs/widgets';
import {convertFormatToMoment} from 'formiojs/utils/utils';
import {formatDate} from './utils';


export class ViewerCalendar extends CalendarWidget {
    constructor(settings, component, instance, index) {
        // console.log('ViewerCalendar')
        // settings.timezone = "Europe/Rome";
        super(settings, component, instance, index);
        // this.originalDisplayInTimezone = this.settings.displayInTimezone;
    }

    setValue(value) {
        let display = this.settings.displayInTimezone === "viewer" ? this.timezone : "utc";
        let val = formatDate(
            this.timezonesUrl,
            value,
            convertFormatToMoment(this.settings.format),
            display,
            convertFormatToMoment("yyyy-MM-ddTHH:mm:ss"));
        super.setValue(val);
    }
}

// Create the viewer calendar.
Widgets.viewercalendar = ViewerCalendar;
