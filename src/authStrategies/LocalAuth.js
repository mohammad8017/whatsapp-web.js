'use strict';

const path = require('path');
const fs = require('fs');
const BaseAuthStrategy = require('./BaseAuthStrategy');

/**
 * Local directory-based authentication
 * @param {object} options - options
 * @param {string} options.clientId - Client id to distinguish instances if you are using multiple, otherwise keep null if you are using only one instance
 * @param {string} options.dataPath - Change the default path for saving session files, default is: "./.wwebjs_auth/" 
*/
class LocalAuth extends BaseAuthStrategy {
    constructor({ clientId, dataPath, session }={}) {
        super();

        const idRegex = /^[-_\w]+$/i;
        if(clientId && !idRegex.test(clientId)) {
            throw new Error('Invalid clientId. Only alphanumeric characters, underscores and hyphens are allowed.');
        }

        this.dataPath = path.resolve(dataPath || './.wwebjs_auth/');
        this.clientId = clientId;
        this.session = session;
    }

    // async afterBrowserInitialized() {
    //     if(this.session) {
    //         console.log('aaaaa');
    //         await this.client.pupPage.evaluateOnNewDocument(session => {
    //             if (document.referrer === 'https://whatsapp.com/') {
    //                 localStorage.clear();
    //                 localStorage.setItem('WANoiseInfo', session.WANoiseInfo);
    //                 localStorage.setItem('WANoiseInfoIv', session.WANoiseInfoIv);
    //                 localStorage.setItem('WAWebEncKeySalt', session.WAWebEncKeySalt);
    //                 localStorage.setItem('WALid', session.WALid);
    //             }
  
    //             localStorage.setItem('remember-me', 'true');
    //         }, this.session);
    //     }
    // }
    // async afterBrowserInitialized() {
    //     const filePath = `${this.userDataDir}/localStorage.json`;
    //     if(fs.existsSync(filePath)) {
    //         console.log('=======1');
    //         const localStorageData = fs.readFileSync(filePath, 'utf8');

    //         // Parse the JSON data
    //         const localStoragee = JSON.parse(localStorageData);

    //         await this.client.pupPage.evaluateOnNewDocument(parsedLocalStorage => {
    //             console.log('=======1');
    //             if (document.referrer === 'https://whatsapp.com/') {
    //             // Clear the existing localStorage
    //                 localStorage.clear();

    //                 // Set the parsedLocalStorage values to localStorage
    //                 for (const key in parsedLocalStorage) {
    //                     console.log('aaaa');
    //                     localStorage.setItem(key, parsedLocalStorage[key]);
    //                 }
    //             }
    //         }, localStoragee);

    //         console.log('localStorage data from the file is set successfully.');
    //     } else {
    //         console.log('localStorage file does not exist.');
    //     }
    // }

    async beforeBrowserInitialized() {
        const puppeteerOpts = this.client.options.puppeteer;
        const sessionDirName = this.clientId ? `session-${this.clientId}` : 'session';
        const dirPath = path.join(this.dataPath, sessionDirName);

        if(puppeteerOpts.userDataDir && puppeteerOpts.userDataDir !== dirPath) {
            throw new Error('LocalAuth is not compatible with a user-supplied userDataDir.');
        }

        fs.mkdirSync(dirPath, { recursive: true });
        
        this.client.options.puppeteer = {
            ...puppeteerOpts,
            userDataDir: dirPath
        };

        this.userDataDir = dirPath;
    }

    async logout() {
        if (this.userDataDir) {
            return (fs.rmSync ? fs.rmSync : fs.rmdirSync).call(this, this.userDataDir, { recursive: true });
        }
    }
    
    async getAuthEventPayload(page) {
        // const isMD = await this.client.pupPage.evaluate(() => {
        //     return window.Store.MDBackend;
        // });

        // if(isMD) throw new Error('Authenticating via JSON session is not supported for MultiDevice-enabled WhatsApp accounts.');

        const localStorage = JSON.parse(await page.evaluate(() => {
            return JSON.stringify(window.localStorage);
        }));
        // console.log(localStorage);
        this.session = {
            WANoiseInfo: localStorage.WANoiseInfo,
            WANoiseInfoIv: localStorage.WANoiseInfoIv,
            WAWebEncKeySalt: localStorage.WAWebEncKeySalt,
            WALid: localStorage.WALid,
        };
        // fs.writeFileSync(`${this.userDataDir}/session.json`, JSON.stringify(this.session), "utf8");
        return {
            WANoiseInfo: localStorage.WANoiseInfo,
            WANoiseInfoIv: localStorage.WANoiseInfoIv,
            WAWebEncKeySalt: localStorage.WAWebEncKeySalt,
            WALid: localStorage.WALid,
        };
    }

}

module.exports = LocalAuth;