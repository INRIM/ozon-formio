import {Formio} from 'formiojs/formio.form.js';
import './components/ViewerCalendar';
import ViewerDateTime from './components/DateTime';
import ViewerTextField from './components/TextField';
import OzonForm from './components/OzonForm';
import {momentDate, formatDate} from './components/utils';
const packageJSON = require('../../package.json');

Formio.Components.setComponent('datetime', ViewerDateTime);
Formio.Components.setComponent('textfield', ViewerTextField);
Formio.version = packageJSON.version;
Formio.Form = OzonForm;
export {Formio};
export {momentDate, formatDate};

