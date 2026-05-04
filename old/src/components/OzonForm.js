"use strict";
import Form from 'formiojs/Form';


export default class OzonForm extends Form {

    constructor(...args) {
        super(...args);
        this.user = {}
    }
}
