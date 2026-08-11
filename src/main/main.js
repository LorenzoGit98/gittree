const electron = require('electron');
const { createMainApplication } = require('./main-application');

createMainApplication({ electron }).start();
