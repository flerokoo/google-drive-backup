const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const path = require("path");

const SCOPES = [
    'https://www.googleapis.com/auth/drive.file'
];

const DEFAULTS = {
    TOKENS_PATH: 'tokens.json',
    CREDENTIALS_PATH: 'credentials.json'
}

let authorizedClients = {};

function readCredentials(path) {
    return new Promise((resolve, reject) => {
        fs.readFile(path, (err, content) => {
            if (err) {
                return reject("Error loading credentials");
            } 
            resolve(JSON.parse(content));
        });
    });
}

function getTokens() {
    return new Promise((resolve) => {
        fs.readFile(DEFAULTS.TOKENS_PATH, (err, content) => {
            if (err) return resolve(null);
            try {
                resolve(JSON.parse(content));
            } catch (e) {
                resolve(null);
            }
        })
    });
}

function getToken(credsPath) {
    return getTokens().then(tokens => {
        return tokens && tokens[credsPath] ? tokens[credsPath] : null;
    });
}

function saveToken(credsPath, token) {
    return getTokens().then(tokens => {
        if (!tokens) tokens = {};
        tokens[credsPath] = token;
        return new Promise((resolve, reject) => {
            fs.writeFile(DEFAULTS.TOKENS_PATH, JSON.stringify(tokens), err => {
                if (err) return reject(err);
                resolve();
            });
        });
    });
}


function authorize(credentialsPath) {
    if (authorizedClients[credentialsPath]) {
        return Promise.resolve(authorizedClients[credentialsPath]);
    }

    var oAuth2Client = null;
    return readCredentials(credentialsPath).then(credentials => {
        const { client_secret, client_id, redirect_uris } = credentials.installed;
        oAuth2Client = new google.auth.OAuth2(
            client_id, client_secret, redirect_uris[0]);
        // Check if we have previously stored a token.
        return getToken(credentialsPath)
    }).then(token => {
        if (token) {
            oAuth2Client.setCredentials(JSON.parse(token));
            authorizedClients[credentialsPath] = oAuth2Client;
            return oAuth2Client;
        }
        
        return getAccessToken(oAuth2Client).then(token => {
            saveToken(credentialsPath, token);
            oAuth2Client.setCredentials(JSON.parse(token));
            authorizedClients[credentialsPath] = oAuth2Client;
            return oAuth2Client;
        });
    });
}

function getAccessToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve, reject) => {
        rl.question('Enter the code from that page here: ', (code) => {
            rl.close();
            oAuth2Client.getToken(code, (err, token) => {
                if (err) reject('Error retrieving access token', err);
                oAuth2Client.setCredentials(token);
                // Store the token to disk for later program executions
                resolve(JSON.stringify(token));
            });
        });
    });
}

function parseNameVersionPair(filename, fallbackToZero = true) {
    let name = path.basename(filename, path.extname(filename));    
    let match = name.match(/(.+)__(\d+)/i);
    if (match) {
        return [match[1], parseInt(match[2])]
    } else {
        return fallbackToZero ? [name, 0] : null;
    }
}

async function backupFile({
    backupFileName,
    credetialsPath = DEFAULTS.CREDENTIALS_PATH,
    sourceFileName,
    incrementVersion = false,
    pageSize = 100
} = {}) {

    if (typeof backupFileName != 'string' || backupFileName.length === 0) {
        throw new Error("backupFileName should be a string of non-null length");
    }

    if (typeof sourceFileName != 'string' || sourceFileName.length === 0) {
        throw new Error("sourceFileName should be a string of non-null length");
    }

    const auth = await authorize(credetialsPath);    
    const drive = google.drive({ version: 'v3', auth });
    const media = { body: fs.createReadStream(sourceFileName) };


    // iterate over pages to get all suitable files
    let allFiles = [];
    let currentPageResponse = null;
    while (currentPageResponse === null || !!currentPageResponse?.data?.nextPageToken) {
        var newPageResponse = await drive.files.list({
            q: `name contains '${path.basename(backupFileName, path.extname(backupFileName))}' and trashed=false`,
            pageSize,
            pageToken: currentPageResponse?.data?.nextPageToken
        });
        
        allFiles.push(...newPageResponse.data.files);
        currentPageResponse = newPageResponse;        
    }    

    allFiles = allFiles.filter(f => {
        return parseNameVersionPair(f.name)[0] === parseNameVersionPair(backupFileName)[0]
    });
    
    const fileExists = allFiles.length > 0;    
    // no files was found, just create a new one and return
    if (!fileExists) {        
        return drive.files.create({
            requestBody: { name: backupFileName },
            media
        });
    }   

 
    // find max version of the file
    const fileEntry = allFiles        
        .reduce((prev, cur) => {
            return parseNameVersionPair(prev.name)[1] < parseNameVersionPair(cur.name)[1]
                ? cur
                : prev;
        });
    

    // create new version of the file (if user said so)
    if (fileExists && incrementVersion) {
        let [name, version] = parseNameVersionPair(fileEntry.name);
        return drive.files.create({
            requestBody: { name : name + "__" + (++version) + path.extname(fileEntry.name) },
            media
        });
    }

    // update existing file
    return drive.files.update({
        fileId: fileEntry.id,
        requestBody: { name: fileEntry.name },
        media
    });    
}

backupFile.defaults = DEFAULTS;

module.exports = backupFile;

