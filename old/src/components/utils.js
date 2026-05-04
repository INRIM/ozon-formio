import {momentDate as formioMomentDate} from 'formiojs/utils/utils.js';
import moment from 'moment';

export function momentDate(value, format, timezone) {
    return formioMomentDate(value, format, timezone);
}

export function formatDate(timezonesUrl, value, format, timezone, flatPickrInputFormat) {
    if (!value) {
        return value;
    }
    if (timezone === 'utc') {
        return moment.utc(value).format(flatPickrInputFormat);
    }
    return moment.utc(value).local().format(flatPickrInputFormat);
}

export default {momentDate, formatDate};
