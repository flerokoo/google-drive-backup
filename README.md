## USAGE

```js
const backup = require("google-drive-backup");

// path to load credentials from
backup.defaults.CREDENTIALS_PATH = "creds/credentials.json";

// path to save/load tokens to/from
backup.defaults.TOKENS_PATH = "creds/token.json";

backup({
    backupFileName: "database.json",
    sourceFileName: "path/to/file/to/backup.json",
    credentialsPath: "path/to/alternative/creds.json", // optionally provide alternative creds
    incrementVersion: false, // set to true to force writing new file instead of updating existing one
    pageSize: 100 // optionally provide a number of items to load during one request to API (1...1000)
});

```