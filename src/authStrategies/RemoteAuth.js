'use strict';

const { MongoClient, Binary } = require('mongodb');
const { resolve } = require('path');
const { BSON } = require('bson');
const AdmZip = require('adm-zip');
/* Require Optional Dependencies */
try {
    var fs = require('fs-extra');
    var unzipper = require('unzipper');
    var archiver = require('archiver');;
} catch {
    fs = undefined;
    unzipper = undefined;
    archiver = undefined;
}

const path = require('path');
const { Events } = require('./../util/Constants');
const BaseAuthStrategy = require('./BaseAuthStrategy');

/**
 * Remote-based authentication
 * @param {object} options - options
 * @param {object} options.store - Remote database store instance
 * @param {string} options.clientId - Client id to distinguish instances if you are using multiple, otherwise keep null if you are using only one instance
 * @param {string} options.dataPath - Change the default path for saving session files, default is: "./.wwebjs_auth/" 
 * @param {number} options.backupSyncIntervalMs - Sets the time interval for periodic session backups. Accepts values starting from 60000ms {1 minute}
 */
class RemoteAuth extends BaseAuthStrategy {
    constructor({ clientId, dataPath, backupSyncIntervalMs } = {}) {
        if (!fs && !unzipper && !archiver) throw new Error('Optional Dependencies [fs-extra, unzipper, archiver] are required to use RemoteAuth. Make sure to run npm install correctly and remove the --no-optional flag');
        super();

        const idRegex = /^[-_\w]+$/i;
        if (clientId && !idRegex.test(clientId)) {
            throw new Error('Invalid clientId. Only alphanumeric characters, underscores and hyphens are allowed.');
        }
        if (!backupSyncIntervalMs || backupSyncIntervalMs < 60000) {
            throw new Error('Invalid backupSyncIntervalMs. Accepts values starting from 60000ms {1 minute}.');
        }

        this.clientId = clientId;
        this.backupSyncIntervalMs = backupSyncIntervalMs;
        this.dataPath = path.resolve(dataPath || './.wwebjs_auth/');
        this.tempDir = `${this.dataPath}/wwebjs_temp_session`;
        this.requiredDirs = ['Default', 'IndexedDB', 'Local Storage']; /* => Required Files & Dirs in WWebJS to restore session */
    }

    async beforeBrowserInitialized() {
        const puppeteerOpts = this.client.options.puppeteer;
        const sessionDirName = this.clientId ? `${this.clientId}/session` : 'RemoteAuth';
        const dirPath = path.join(this.dataPath, sessionDirName);

        if (puppeteerOpts.userDataDir && puppeteerOpts.userDataDir !== dirPath) {
            throw new Error('RemoteAuth is not compatible with a user-supplied userDataDir.');
        }

        this.userDataDir = dirPath;
        this.sessionName = sessionDirName;

        await this.extractRemoteSession();

        this.client.options.puppeteer = {
            ...puppeteerOpts,
            userDataDir: dirPath
        };
    }

    async logout() {
        await this.disconnect();
    }

    async destroy() {
        clearInterval(this.backupSync);
    }

    async disconnect() {
        await this.deleteRemoteSession();

        let pathExists = await this.isValidPath(this.userDataDir);
        if (pathExists) {
            await fs.promises.rm(this.userDataDir, {
                recursive: true,
                force: true
            }).catch(() => {});
        }
        clearInterval(this.backupSync);
    }

    async afterAuthReady() {
        const dbRecord = await this.readDb(this.clientId);
        const sessionExists = dbRecord === null ? false : true;
        if(!sessionExists) {
            await this.delay(15000); /* Initial delay sync required for session to be stable enough to recover */
            await this.storeRemoteSession({emit: true});
        } else {
            await this.delay(15000);
            await this.updateRemoteSession();
        }
        var self = this;
    }

    async storeRemoteSession(options) {
        /* Compress & Store Session */
        const pathExists = await this.isValidPath(this.userDataDir);
        if (pathExists) {
            await this.compressSession();
            const uri = 'mongodb://172.29.30.110:27017/?readPreference=primary&authSource=admin&directConnection=true&ssl=false'; // replace with your MongoDB connection URI
            const dbName = 'WhatsappMicroServices'
            const collectionName = 'WhatsappProvider';
            const zipData = fs.readFileSync(`${this.clientId}.zip`);
            let dbClient = new MongoClient(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });
            const t = new Promise((resolve, rejects) => {
                dbClient.connect();
                resolve(dbClient);
            })
            const collection = dbClient.db(dbName).collection(collectionName);
            const document = { 
                managerId: this.clientId, 
                session : new BSON.Binary(zipData), 
                lastCheck: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tehran' }), 
                authenticated: true,
            };
            const result = new Promise((resolve, rejects) => {
                collection.insertOne(document, (err, result) => {
                    if (err) {
                        console.error(err);
                    } else {
                        console.log('Zip file saved successfully!');
                    }
                    // Close the MongoDB connection
                    dbClient.close();
                    resolve();
                });
            })
            await fs.promises.unlink(`${this.clientId}.zip`);
            await fs.promises.rm(`${this.tempDir}`, {
                recursive: true,
                force: true
            }).catch(() => {});
            if(options && options.emit) this.client.emit(Events.REMOTE_SESSION_SAVED);
        }
    }

    async updateRemoteSession(){
        const pathExists = await this.isValidPath(this.userDataDir);
        if (pathExists) {
            await this.compressSession();
            const uri = 'mongodb://172.29.30.110:27017/?readPreference=primary&authSource=admin&directConnection=true&ssl=false'; // replace with your MongoDB connection URI
            const dbName = 'WhatsappMicroServices'
            const collectionName = 'WhatsappProvider';
            const zipData = fs.readFileSync(`${this.clientId}.zip`);
            let dbClient = new MongoClient(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });
            const t = new Promise((resolve, rejects) => {
                dbClient.connect();
                resolve(dbClient);
            })
            const collection = dbClient.db(dbName).collection(collectionName);
            const resultUpdate = await collection.updateOne(
                { managerId: this.clientId },
                { $set: 
                    { 
                        session : new BSON.Binary(zipData), 
                        lastCheck: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tehran' }) 
                    } 
                }
            );
            await fs.promises.unlink(`${this.clientId}.zip`);
            await fs.promises.rm(`${this.tempDir}`, {
                recursive: true,
                force: true
            }).catch(() => {});
            console.log('session updated.');
        }
    }

    async extractRemoteSession() {
        const pathExists = await this.isValidPath(this.userDataDir);
        const compressedSessionPath = `${this.clientId}.zip`;
        const dbRecord = await this.readDb(this.clientId);
        const sessionExists = dbRecord === null ? false : true;
        if (pathExists) {
            await fs.promises.rm(this.userDataDir, {
                recursive: true,
                force: true
            }).catch(() => {});
        }
        if (sessionExists) {
            // Convert BSON.Binary to Buffer
            const zipData = Buffer.from(dbRecord['session'].buffer);
            // Create a new zip file
            fs.writeFileSync(`${this.clientId}.zip`, zipData);
            console.log("New zip file created successfully.");
            await this.unCompressSession(compressedSessionPath);
        } else {
            fs.mkdirSync(this.userDataDir, { recursive: true });
        }
    }

    async readDb(managerId) {
        try {
            const uri = 'mongodb://172.29.30.110:27017/?readPreference=primary&authSource=admin&directConnection=true&ssl=false'; // replace with your MongoDB connection URI
            const dbName = 'WhatsappMicroServices'
            const collectionName = 'WhatsappProvider';
            let dbClient = new MongoClient(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });
            await dbClient.connect();
            console.log("Connected to MongoDB!");
            const collection = dbClient
                .db(dbName)
                .collection(collectionName);
            const query = { managerId: managerId };
            const options = { projection: { _id: 0 }, sort: { _id: -1 } };
            const result = await collection.findOne(query, options);
            const resultUpdate = await collection.updateOne(
                { managerId: this.clientId },
                { $set: { lastCheck: new Date().toLocaleString('en-US', { timeZone: 'Asia/Tehran' }) } }
            );
            return result;
        } catch (err) {
            console.log(err);
        } finally {
            // dbClient.close();
        }
    }

    async deleteRemoteSession() {
        const dbRecord = await this.readDb(this.clientId);
        const sessionExists = dbRecord === null ? false : true;
        if (sessionExists){
            await this.removeSession();
        }
    }

    async removeSession() {
        const client = new MongoClient(uri);
        try {
            const uri = 'mongodb://172.29.30.110:27017/?readPreference=primary&authSource=admin&directConnection=true&ssl=false'; // replace with your MongoDB connection URI
            const dbName = 'WhatsappMicroServices'
            const collectionName = 'WhatsappProvider';
            let dbClient = new MongoClient(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });
            await dbClient.connect();
            console.log("Connected to MongoDB!");
            const collection = dbClient
                .db(dbName)
                .collection(collectionName);
            
            // Delete the document(s) with matching managerId
            const result = await collection.deleteMany({ managerId: this.clientId });
            
            console.log(`${result.deletedCount} document(s) deleted.`);
        } finally {
          await client.close();
        }
      }

    async compressSession() {
        const archive = archiver('zip');
        const stream = fs.createWriteStream(`${this.clientId}.zip`);

        await fs.copy(this.userDataDir, this.tempDir).catch(() => {});
        await this.deleteMetadata();
        return new Promise((resolve, reject) => {
            archive
                .directory(this.tempDir, false)
                .on('error', err => reject(err))
                .pipe(stream);

            stream.on('close', () => resolve());
            archive.finalize();
        });
    }

    async unCompressSession(compressedSessionPath) {
        const zip = new AdmZip(compressedSessionPath);
        zip.extractAllTo(this.userDataDir, true);
        await fs.promises.unlink(compressedSessionPath);
    }

    async deleteMetadata() {
        const sessionDirs = [this.tempDir, path.join(this.tempDir, 'Default')];
        for (const dir of sessionDirs) {
            const sessionFiles = await fs.promises.readdir(dir);
            for (const element of sessionFiles) {
                if (!this.requiredDirs.includes(element)) {
                    const dirElement = path.join(dir, element);
                    const stats = await fs.promises.lstat(dirElement);
    
                    if (stats.isDirectory()) {
                        await fs.promises.rm(dirElement, {
                            recursive: true,
                            force: true
                        }).catch(() => {});
                    } else {
                        await fs.promises.unlink(dirElement).catch(() => {});
                    }
                }
            }
        }
    }

    async isValidPath(path) {
        try {
            await fs.promises.access(path);
            return true;
        } catch {
            return false;
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = RemoteAuth;
