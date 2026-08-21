const electron = require('electron');
const { createMainApplication } = require('./main-application.mts');

createMainApplication({ electron }).start();
