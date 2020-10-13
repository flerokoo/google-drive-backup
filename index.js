const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const path = require("path");

const SCOPES = [
    'https://www.googleapis.com/auth/drive.file'
];

const DEFAULTS = {
    TOKEN_PATH: 'token.json',
    CREDENTIALS_PATH: 'credentials.json'
}

let authorizedClient = null;

function readCredentials(path) {
    return new Promise((resolve, reject) => {
        fs.readFile(path || DEFAULTS.CREDENTIALS_PATH, (err, content) => {
            if (err) {
                return reject("Error loading credentials");
            } 
            resolve(JSON.parse(content));
        });
    });
}

function authorize(credentialsPath) {
    if (authorizedClient !== null)
        return Promise.resolve(authorizedClient);

    return readCredentials(credentialsPath).then(credentials => {
        const { client_secret, client_id, redirect_uris } = credentials.installed;
        const oAuth2Client = new google.auth.OAuth2(
            client_id, client_secret, redirect_uris[0]);

        // Check if we have previously stored a token.
        return new Promise((resolve) => {
            fs.readFile(DEFAULTS.TOKEN_PATH, (err, token) => {
                if (err) return getAccessToken(oAuth2Client);
                oAuth2Client.setCredentials(JSON.parse(token));
                authorizedClient = oAuth2Client;
                resolve(oAuth2Client);
            });
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
                fs.writeFile(DEFAULTS.TOKEN_PATH, JSON.stringify(token), (err) => {
                    if (err) return console.error(err);
                    console.log('Token stored to', TOKEN_PATH);
                });
                resolve(oAuth2Client);
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
    credetialsPath,
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
    const requestBody = { name: backupFileName };
    const media = { body: fs.createReadStream(sourceFileName) };


    // iterate over pages to get all suitable files
    const allFiles = [];
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
    
    const fileExists = allFiles.length > 0;    
    // no files was found, just create a new one and return
    if (!fileExists) {        
        return drive.files.create({
            requestBody,
            media
        });
    }   

    // find max version of the file
    const fileEntry = allFiles.reduce((prev, cur) => {
        return parseNameVersionPair(prev.name)[1] < parseNameVersionPair(cur.name)[1]
            ? cur
            : prev;
    });
    console.log(fileEntry)

    // create new version of the file (if user said so)
    if (fileExists && incrementVersion) {
        let [name, version] = parseNameVersionPair(fileEntry.name);
        requestBody.name = name + "__" + (++version) + path.extname(fileEntry.name);
        return drive.files.create({
            requestBody,
            media
        });
    }

    // update existing file
    return drive.files.update({
        fileId: fileEntry.id,
        requestBody,
        media
    });    
}

backupFile.defaults = DEFAULTS;

module.exports = backupFile;

backupFile({
    backupFileName: "TESTTT.txt",
    sourceFileName: "test.txt",
    incrementVersion: true
});