//#region MODULES AND VARIABLES

//import modules
require('dotenv').config();
const axios = require('axios');
const path = require('path');
const express = require('express');
const lx = require('luxon');
const http = require('http');
const qs = require('qs');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const ss = require('smartsheet');
const api = require('./api');
const crypto = require('crypto');
const { env } = require('process');
const { load } = require('dotenv');
const {Storage} = require('@google-cloud/storage');

//assign environment variables to local variables
var environment = {};

if (process.env.IS_DEV === "true") {
  environment.oauthCallback = process.env.DEV_FORGE_CALLBACK_URL;
  environment.workitemCallback = process.env.DEV_FORGE_WEBHOOK_URL;
  environment.workitemBatchCallback = process.env.DEV_FORGE_WEBHOOK_BATCH_URL;
  environment.appUrl = process.env.DEV_APP_URL;
}
else {
  environment.oauthCallback = process.env.FORGE_CALLBACK_URL;
  environment.workitemCallback = process.env.FORGE_WEBHOOK_URL;
  environment.workitemBatchCallback = process.env.FORGE_WEBHOOK_BATCH_URL;
  environment.appUrl = process.env.APP_URL;
}

//declare other local variables
const PORT = process.env.PORT || 3000;

const scopes = {
  internal_2legged: 'code:all data:create data:write data:read data:search bucket:create bucket:delete bucket:read',
  public_3legged: 'data:read data:write data:search bucket:read code:all'
};

const designAutomation = {
  webhook_url: environment.workitemCallback,
  endpoint: 'https://developer.api.autodesk.com/da/us-east/v3/',
  app_alias: process.env.DESIGN_AUTOMATION_APP_ALIAS,
};

var smartsheet = ss.createClient({
  accessToken: process.env.SMARTSHEET_KEY,
  logLevel: "info"
})

const gcloud = new Storage();

const outputBucketKey = "blox_script-runner-results";
const signedUploads = process.env.SIGNED_UPLOADS === "true"; //true if "true". false if anything else
const secret = 'G3&%/(cn6J([M`@__5jzNgTk6*BO[@';
const scriptAlias = process.env.IS_DEV === "true" ? "dev" : "prod";

var token2;
var token2timestamp;
var userSessions = {};
//#endregion

//#region SET UP SERVER

//app set up
const app = express();

app.use(cookieParser(secret));

app.use(express.json({ limit: '50mb' }));

app.use(express.static('public'));

//server set up
var server = http.Server(app);

//luxon set up / config time zone
lx.Settings.defaultZone = "America/Chicago"

//socket set up
const io = new Server(server);

io.on('connection', (socket) => {
  socket.on('data', function(user) {
    console.log('--- '+user+' connected at socket '+socket.id+' ---');
    userSessions[user] = socket.id;
  });
});
//#endregion

//#region ROUTES

//serve main page at route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '/public/index.html'));
});

//get login credentials if present
app.get('/user-profile', (req, res) => {
  res.send(req.cookies.userInfo);
});

//user log out
app.get('/user-reset', (req, res) => {
  let userInfo = req.cookies.userInfo;

  if (userInfo != null) {
    api.purgeWorkItemLog(smartsheet, 14);
  }

  //clear cookie info
  res.cookie('userInfo', null, {maxAge: 0});
  res.cookie('token', null, {maxAge: 0});
  res.cookie('refresh', null, {maxAge: 0});

  res.send();
});

//2-legged token
app.get('/token', (req,res) => {
  res.send(req.cookies.token);
});

//redirect login to autodesk authentication
app.get('/oauth', (req, res) => {
  res.redirect(
    `https://developer.api.autodesk.com/authentication/v2/authorize?client_id=${process.env.FORGE_CLIENT_ID}&response_type=code&redirect_uri=${environment.oauthCallback}&scope=${scopes.public_3legged}`,
  );
});

//handle callback and get access token and user info
app.get('/oauth/callback', (req, res) => {
    const data = qs.stringify({
      'grant_type': 'authorization_code',
      'code': req.query.code,
      'redirect_uri': environment.oauthCallback 
    });

    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://developer.api.autodesk.com/authentication/v2/token',
      headers: { 
        'Authorization': 'Basic ' + btoa(process.env.FORGE_CLIENT_ID+":"+process.env.FORGE_CLIENT_SECRET), 
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data : data
    };

    //get 3-legged token
    axios.request(config)
    //then get user info
    .then((response) => {
      res.cookie('token', response.data.access_token, {maxAge: 1000 * 60 * 59, httpOnly: true}); 
      res.cookie('refresh', response.data.refresh_token);

      const userconfig = {
        method: 'get',
        maxBodyLength: Infinity,
        url: 'https://api.userprofile.autodesk.com/userinfo',
        headers: {
          'Authorization': response.data.access_token
        }
      };

      return axios.request(userconfig);
    })
    //then send user back to main page with cookies
    .then((response) => {
      res.cookie('userInfo', response.data, {httpOnly: true});
      res.redirect(environment.appUrl);
    })
    .catch((error) => {
      console.log(error);
    });
});

//get high level directories (hubs, projects, top folders) from ACC
app.get('/acc-data/rootFolders', async (req, res) => {
  let token3 = req.cookies.token;

  const tokenCheck = await api.checkTokens(req, res);
  token3 = tokenCheck.token;
  res = tokenCheck.response;

  api.getSmartsheet(smartsheet);
  api.purgeOutputFolder();

  if (token3) {      
    let hubs;
    let projects;
    let topFolders;
    let payload;

    const baseUrl = 'https://developer.api.autodesk.com/project/v1/hubs/';
    const baseConfig = {
      method: 'get',
      maxBodyLength: Infinity,
      url: '',
      headers: { 
        'Authorization': 'Bearer ' + token3
      }
    }

    let hubConfig = baseConfig;
    hubConfig.url = baseUrl;

    //request hubs
    axios.request(hubConfig)
    //then request projects
    .then((hubResponse) => {
      hubs = hubResponse.data.data.map((hub)=>api.reformatToNode(hub));
      payload = hubs;

      projectConfigs = hubs.map((hub) => {
        let myConfig = structuredClone(baseConfig);
        myConfig.url = baseUrl+ hub.id +'/projects/';
        return myConfig;
      });

      return axios.all(projectConfigs.map((config) => axios.request(config)));
    })
    //then request top folders
    .then((projectResponses) => {
      projects = projectResponses.map((response) => {
        return api.processProjects(response.data.data, true);
      }).flat();
      payload = payload.concat(projects);

      topFolderConfigs = projects.map((project) => {
        let myConfig = structuredClone(baseConfig);
        myConfig.url = baseUrl+ project.parent +'/projects/'+ project.id + "/topFolders";
        return myConfig;
      });

      return axios.all(topFolderConfigs.map((config) => axios.request(config)))
    })
    //then get top folder content
    .then((folderResponses) => {
      topFolders = folderResponses.map((response) => api.processFolders(response.data.data, true)).flat();
      payload = payload.concat(topFolders);

    //   return axios.all(topFolders.map((folder) => api.getFolderContents(folder, token3)));
    // })
    // // then send response back to app
    // .then((responses) => {
    //   responseData = responses.flat().map((item) => {return item.data.data}).flat();

    //   var folders = [];
    //   var items = [];
  
    //   responseData.forEach((entity) => {
    //     switch (entity.type) {
    //       case 'folders':
    //         folders = folders.concat(entity);
    //         break;
    //       case 'items':
    //         items = items.concat(entity);
    //         break;
    //       default:
    //         console.log('Data fallthrough!');
    //     }
    //   });
    
    //   folders = api.processFolders(folders);
    //   items = api.processItems(items);

    //   payload = payload.concat(folders);
    //   payload = payload.concat(items);

      res.send(payload)
    })
    .catch((error) => {
      console.log(error);
    });
  }
  else res.status(401).send('Authorization expired.');
});

//recursively get all folder contents from ACC
app.post('/acc-data/folderContents', async (req, res) => {
  let token3 = req.cookies.token;

  const tokenCheck = await api.checkTokens(req, res);
  token3 = tokenCheck.token;
  res = tokenCheck.response;

  if (token3) {
    let folders;
    let items;
    let payload = [];

    //open folder
    api.getFolderContents(req.body, token3)
    //then recursively loop through children
    .then((response) => {
      folders = [];
      items = [];
      let n = 3;
      return api.getAllContents([response], folders, items, n, token3);
    })
    //then send response
    .then((response) => {   
      folders = response[0];
      items = response[1];

      payload = payload.concat(folders);
      payload = payload.concat(items);

      res.send(payload);
    })
    .catch((error) => {
      console.log(error);
    });
  }
  else res.status(401).send('Authorization expired.');
});

//search folder for item with name containing search key
app.post('/acc-data/folderSearch', async (req, res) => {
  let folder = req.body.node;
  let searchString = req.body.searchString;

  let token3 = req.cookies.token;

  const tokenCheck = await api.checkTokens(req, res);
  token3 = tokenCheck.token;
  res = tokenCheck.response;

  if (token3) {
    api.searchFolderContents(folder, searchString, token3)
    .then(response => {
      var items = response.data.included;

      if (items !== undefined) {
        var i = api.processItems(items);
        res.send(i);
      }
      else res.send();
    })
    .catch((error) => {
      console.log(error);
    });
  }
  else res.status(401).send('Authorization expired.');
});

//retrieve item version(s) from ACC
app.post('/acc-data/itemVersions', async (req, res) => {
  let token3 = req.cookies.token;
    
  const tokenCheck = await api.checkTokens(req, res);
  token3 = tokenCheck.token;
  res = tokenCheck.response;

  if (token3) {
    let items = req.body.data;
    let getAll = req.body.getAll;
    let payload;

    //get item versions
    axios.all(items.map((item) => {
      return api.getItemVersions(item, token3);
    }))
    //then send payload
    .then((response) => {

      let responseData = response.map(item => item.data.data);
      let versions = responseData.map(api.processVersions);

      if (getAll) {
        payload = versions.flat();
      }
      else {
        payload = versions.map((versionSet) => {return versionSet[0]}).flat();
      }

      //res.send(responseData);
      res.send(payload);
    })
    .catch((error) => {
      console.log(error);
    });
  }
  else res.status(401).send('Authorization expired.');
});

//refresh server copy of lookup table from smartsheet
app.get('/smartsheet', async (req, res) => {
  api.getSmartsheet(smartsheet)
  .then(
    res.redirect("/lookupTable.csv")
  )
  .catch((error) => {
    console.log(error);
  });
});

//send recent jobs to user
app.get('/recent-jobs', async (req, res) => {
  if (req.cookies.userInfo !== undefined) {
    let user = req.cookies.userInfo.email;

    api.getWorkItemLog(smartsheet, user, 7) //limit to last 3 days
    .then((rows) => {
      data = rows.map(r => r.cells);
      res.send(data);
    })
    .catch((error) => {
      console.log(error);
    });
  }
  else {
    res.send([]);
  }
});

//refresh download urls in log
app.get('/recent-jobs/refresh-urls', async (req, res) => {
  //check if token2 is expired, refresh if necessary
  if (token2timestamp == undefined || lx.DateTime.now().toSeconds()-token2timestamp.toSeconds() > 3599) {
    await api.oauth2legged(scopes)
    .then((response) => {
      console.log("--- REFRESHING 2-LEGGED TOKEN ---");

      token2 = response.data.access_token;
      token2timestamp = lx.DateTime.now();
    })
    .catch((error) => {
      console.log(error);
    });
  }

  if (req.cookies.userInfo !== undefined) {
    let user = req.cookies.userInfo.email;
    let myRows;

    api.getWorkItemLog(smartsheet, user)
    //get download urls
    .then((rows) => {
      //filter out rows without urls, then get row data
      myRows = rows.filter(row => row.cells[10].value !== undefined);
      let data = myRows.map(r => r.cells);

      //send requests for new urls
      return axios.all(data.map(cellSet => {
        let script = cellSet[6].value;
        let file = cellSet[7].value;
        let timeSubmitted = cellSet[4].value;
  
        let objectKey = script+"_"+file+"_"+timeSubmitted+".zip";

        return api.getObjectDownloadUrl(outputBucketKey, objectKey, token2);
      }));
    })
    //update urls in smartsheet
    .then((responses) => {
      let downloadUrls = responses.flat().map((res) => res.data.url)
      
      downloadUrls.forEach((url, i) => {
        api.refreshWorkItemUrl(smartsheet, myRows[i].id, url)
      });

      res.send("success");
    })
    .catch((error) => {
      console.log(error);
    });
  }
  else {
    res.send("failure");
  }
});

//submit work item
app.get('/work-item/submit', async (req, res) => {
  let token3 = req.cookies.token;
  let userInfo = req.cookies.userInfo;
  let script = req.query.script;
  const model = req.query.model;
  const loadFromCloud = req.query.loadFromCloud;
  const includeLinks = req.query.includeLinks;
  
  let objectKey;
  let uploadParams;
  let downloadUrl;
  let dateTime;

  //override script!
  if (loadFromCloud == "false" && script == "BOMGeneratorActivity2") {
    script = "BOMGeneratorActivity";
  }

  const tokenCheck = await api.checkTokens(req, res);
  token3 = tokenCheck.token;

  if (token3) {    
    api.oauth2legged(scopes)
    //get existing buckets
    .then((response) => {
      token2 = response.data.access_token;
      token2timestamp = lx.DateTime.now();

      return api.getBuckets(token2);
    })
    //create new bucket if does not exist
    .then((response) => {
      //update bucketKeys with active buckets
      let bucketKeys = [];
      if (response.data.items.length>0) {
        bucketKeys = response.data.items.map((item) => item.bucketKey);
      }

      //if no output bucket exists, create it
      if (!bucketKeys.includes(outputBucketKey)) {
        return api.createBucket(outputBucketKey, token2)
      }
    })
    //create download URL for input.rvt (if necessary)
    .then(() => {
      if (loadFromCloud == "false") {
        return api.getModelDownloadUrl(model, token2);
      }
    })
    //create upload URL for output.zip
    .then((response) => {
      if (response !== undefined) {
        downloadUrl = response.data.url
      }

      dateTime = lx.DateTime.now().toFormat('yyMMdd-HHmm');
      objectKey = script+"_"+model.text+"_"+dateTime+".zip";

      if (signedUploads) {
        return api.getObjectUploadUrl(outputBucketKey, objectKey, token2);
      }

      else return undefined;
    })
    //then submit workitem
    .then((response)=>{
      if (response !== undefined) {
        uploadParams = {
          uploadKey: response.data.uploadKey,
          uploadUrl: response.data.urls[0]
        }
      }
      else {
        uploadParams = {
          uploadUrl: `urn:adsk.objects:os.object:${outputBucketKey}/${objectKey}`
        }
      }

      var options = {
        environment: environment,
        batch: false,
        token2: token2,
        token3: token3,
        objectKey: objectKey,
        uploadParams: uploadParams,
        downloadUrl: downloadUrl,
        appVariables: designAutomation,
        loadFromCloud: loadFromCloud,
        includeLinks: includeLinks,
        scriptAlias: scriptAlias,
        signedUploads: signedUploads
      }

      return api.submitWorkitem(script, model, options);
    })
    //then add job to queue and respond to client
    .then((response) => {
      console.log("+++ 1 REQUEST SENT BY "+ userInfo.email +" AT " + lx.DateTime.now().toLocaleString(lx.DateTime.DATETIME_SHORT) + " +++");

      let job = {
        id: response.data.id,
        batch: false,
        script: script,
        oFile: objectKey,
        user: userInfo.email,
        uploadKey: uploadParams.uploadKey,
        fileName : model.text,
        timeSubmitted : dateTime,
        status : "in progress",
        batchId : crypto.randomUUID()
      }

      //add job to smartsheet log
      api.logWorkItem(job);
      console.log([job.id]);
      
      res.send("success");
    })
    .catch((error) => {
      console.log(error);
      res.send("failure");
    });
  }
  else res.status(401).send('Authorization expired.');
});

//submit work item batch
app.get('/work-item/submit-batch', async (req, res) => {
  let token3 = req.cookies.token;
  let userInfo = req.cookies.userInfo;
  let script = req.query.script;
  const models = req.query.models;
  const currentBatchSize = models.length;
  const loadFromCloud = req.query.loadFromCloud;
  const includeLinks = req.query.includeLinks;

  let objectKeys;
  let uploadParams;
  let downloadUrls;
  let dateTime;

  //override script!
  if (loadFromCloud == "false" && script == "BOMGeneratorActivity2") {
    script = "BOMGeneratorActivity";
  }

  const tokenCheck = await api.checkTokens(req, res);
  token3 = tokenCheck.token;

  if (token3) {
    api.oauth2legged(scopes)
    //get existing buckets
    .then((response) => {
      token2 = response.data.access_token;
      token2timestamp = lx.DateTime.now();

      return api.getBuckets(token2);
    })
    //create new bucket if does not exist
    .then((response) => {
      //update bucketKeys with active buckets
      let bucketKeys = [];
      if (response.data.items.length>0) {
        bucketKeys = response.data.items.map((item) => item.bucketKey);
      }

      //if no output bucket exists, create it
      if (!bucketKeys.includes(outputBucketKey)) {
        return api.createBucket(outputBucketKey, token2)
      }
    })
    //create download URL for input.rvt (if necessary)
    .then(() => {
      if (loadFromCloud == "false") {
        return axios.all(models.map(model => api.getModelDownloadUrl(model, token2)));
      }
      else {
        return undefined;
      }
    })
    //create upload URLs for output files
    .then((responses) => {
      if (responses !== undefined) {
        downloadUrls = responses.flat().map((res) => res.data.url);
      }

      dateTime = lx.DateTime.now().toFormat('yyMMdd-HHmm');
      objectKeys = models.map(model => script+"_"+model.text+"_"+dateTime+".zip");

      if (signedUploads) {
        return axios.all(objectKeys.map(objectKey => api.getObjectUploadUrl(outputBucketKey, objectKey, token2)));
      }
      else return undefined;
    })
    //submit workitems
    .then((responses)=>{
      if (responses !== undefined) {
        uploadParams = responses.flat().map((res) => {return {
          uploadKey: res.data.uploadKey,
          uploadUrl: res.data.urls[0]
        }});
      }
      else {
        uploadParams = objectKeys.map((objectKey) => {return {
          uploadUrl: `urn:adsk.objects:os.object:${outputBucketKey}/${objectKey}`
        }});
      }

      var options = {
        environment: environment,
        batch: true,
        token2: token2,
        token3: token3,
        signedUploads: signedUploads,
        appVariables: designAutomation,
        loadFromCloud: loadFromCloud,
        includeLinks: includeLinks,
        scriptAlias: scriptAlias
      }

      var optionsList = models.map((model, i) => {
        //create a unique copies of "options" object for each model
        var myOptions = Object.assign({}, options);

        //assign unique download/upload params
        if (downloadUrls !== undefined) {
          myOptions.downloadUrl = downloadUrls[i];
        }
        myOptions.uploadParams = uploadParams[i];
        myOptions.objectKey = objectKeys[i];

        return myOptions;
      });

      return axios.all(models.map((model, i) => api.submitWorkitem(script, model, optionsList[i])));    
    })
    //add jobs to queue and respond to client
    .then((response) => {
      console.log("+++ BATCH OF " + currentBatchSize + " REQUESTS SENT BY " + userInfo.email +" AT " + lx.DateTime.now().toLocaleString(lx.DateTime.DATETIME_SHORT) + " +++");

      let batchId = crypto.randomUUID();
      res.cookie('batchId', batchId);

      let job = {
        ids: response.flat().map((req)=>{return req.data.id}),
        batch: true,
        batchId : batchId,
        script: script,
        oFiles: objectKeys,
        uploadKeys: uploadParams.map(p => p.uploadKey),
        user: userInfo.email,
        fileNames : models.map(model => model.text),
        timeSubmitted : dateTime,
        size: currentBatchSize,
        status : "in progress",
        completed: 0,
        succeeded: [],
        failed: []
      }

      //add job to smartsheet log
      api.logWorkItem(job);
      console.log(job.ids);
      
      res.send("success");
    })
    .catch((error) => {
      console.log(error);
      res.send("failure");
    });
  }
  else res.status(401).send('Authorization expired.');
});

//catch callbacks for single work items
app.post('/work-item/callback', async (req, res) => {
  console.log("+++ RECEIVED CALLBACK AT " + lx.DateTime.now().toLocaleString(lx.DateTime.DATETIME_SHORT) + " +++");
  
  //get job from workitem log
  let response = req.body;
  let myJob = await api.getWorkItemByID(smartsheet, response.id)
  .catch((error) => {
    console.log(error);
  });

  //if found, process response
  if (myJob !== undefined) {
    console.log([myJob.user, response.id, response.status]);

    myJob.status = response.status;
    myJob.timeReturned = lx.DateTime.now().toFormat('yyMMdd-HHmm');

    //check if token2 is expired, refresh if necessary
    if (token2timestamp == undefined || lx.DateTime.now().toSeconds()-token2timestamp.toSeconds() > 3599) {
      await api.oauth2legged(scopes)
      .then((response) => {
        console.log("--- REFRESHING 2-LEGGED TOKEN ---");

        token2 = response.data.access_token;
        token2timestamp = lx.DateTime.now();
      })
      .catch((error) => {
        console.log(error);
      });
    }

    //update jobs log and send results back to client
    if (myJob.status == "success" && myJob.downloadUrl === undefined) {
      //complete oss upload
      api.postObjectUpload(outputBucketKey, myJob.oFile, myJob.uploadKey, token2)
      //get download URL
      .then(() =>
        api.getObjectDownloadUrl(outputBucketKey, myJob.oFile, token2)
      )
      //send download URL to client
      .then(async (response) => {
        downloadUrl = response.data.url;
        io.to(userSessions[myJob.user]).emit('result', downloadUrl);

        //log response
        await api.updateWorkItemLog(smartsheet, myJob.id, myJob.timeReturned, myJob.status, downloadUrl);

        //save response to smartsheet if BOM script
        if (myJob.script.toUpperCase().startsWith("BOM")) {
          api.saveWorkItemResults(smartsheet, gcloud, downloadUrl);
        }
      })
      .catch((error) => {
        console.log(error);
      });
    }
    else if (myJob.status.startsWith("fail")) {
      io.to(userSessions[myJob.user]).emit('failure', myJob.id);

      api.updateWorkItemLog(smartsheet, myJob.id, myJob.timeReturned, myJob.status, "");
    }
  }
  //else ignore
  else {
    console.log(["USER UNKNOWN", response.id, response.status]);
    console.log('+++ WORKITEM NOT FOUND. IGNORING... +++');
  }
});

//catch callbacks for batch work items
app.post('/work-item/callback-batch', async (req, res) => {
  console.log("+++ RECEIVED CALLBACK AT " + lx.DateTime.now().toLocaleString(lx.DateTime.DATETIME_SHORT) + " +++");

  //get job from workitem log
  let response = req.body;
  let myJob = await api.getWorkItemByID(smartsheet, response.id)
  .catch((error) => {
    console.log(error);
  });

  //if job found, process response
  if (myJob != undefined) {
    console.log([myJob.user, response.id, response.status]);

    myJob.status = response.status;
    myJob.timeReturned = lx.DateTime.now().toFormat('yyMMdd-HHmm');

    //check if token2 is expired, refresh if necessary
    if (token2timestamp == undefined || lx.DateTime.now().toSeconds()-token2timestamp.toSeconds() > 3599) {
      await api.oauth2legged(scopes)
      .then((response) => {
        console.log("--- REFRESHING 2-LEGGED TOKEN ---");

        token2 = response.data.access_token;
        token2timestamp = lx.DateTime.now();
      })
      .catch((error) => {
        console.log(error);
      });
    }

    //update jobs log and update client
    if (myJob.status == "success") {
      //complete oss upload
      api.postObjectUpload(outputBucketKey, myJob.oFile, myJob.uploadKey, token2)
      //get download URL
      .then(() =>
        api.getObjectDownloadUrl(outputBucketKey, myJob.oFile, token2)
      )
      //send download URL to client
      .then(async (response) => {
        downloadUrl = response.data.url;

        //log response
        await api.updateWorkItemLog(smartsheet, myJob.id, myJob.timeReturned, myJob.status, downloadUrl);

        //save response to smartsheet if BOM script
        if (myJob.script.toUpperCase().startsWith("BOM")) {
          api.saveWorkItemResults(smartsheet, gcloud, downloadUrl);
        }
      })
      .catch((error) => {
        console.log(error);
      });
    }
    else {
      api.updateWorkItemLog(smartsheet, myJob.id, myJob.timeReturned, myJob.status, "");
    }
  }
  //else ignore
  else {
    console.log(["USER UNKNOWN", response.id, response.status]);
    console.log('+++ WORKITEM NOT FOUND. IGNORING... +++');
  }

  io.to(userSessions[myJob.user]).emit('update');
});

//get failure report
app.post('/work-item/report', async (req, res) => {
  //check if token2 is expired, refresh if necessary
  if (token2timestamp == undefined || lx.DateTime.now().toSeconds()-token2timestamp.toSeconds() > 3599) {
    await api.oauth2legged(scopes)
    .then((response) => {
      console.log("--- REFRESHING 2-LEGGED TOKEN");

      token2 = response.data.access_token;
      token2timestamp = lx.DateTime.now();
    })
    .catch((error) => {
      console.log(error);
    });
  }

  if (token2 !== undefined) {
    let workItem = req.body.workItem;
    
    let config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: 'https://developer.api.autodesk.com/da/us-east/v3/workitems/'+workItem,
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': 'Bearer '+token2, 
      }
    };

    axios.request(config)
    .then((response) => {
      res.send({reportUrl: response.data.reportUrl, debugUrl: response.data.debugUrl});
    });
  }
});

//get batch status
app.get('/work-item/batch-status', async (req, res) => {
  let batchId = req.cookies.batchId;

  api.getWorkItemBatchStatus(smartsheet, batchId)
  .then((batchStatus) => {
    res.send(batchStatus);
  })
  .catch((error) => {
    console.log(error);
    res.send(undefined);
  });
});

//get batch results
app.get('/work-item/batch-result', async (req, res) => {
  let batchId = req.cookies.batchId;
  
  //get batch items
  api.getWorkItemBatch(smartsheet, batchId)
  .then((batchRows) => {
    let failedItems = batchRows.filter(row => (row.cells[8].value != "success") && (row.cells[8].value != "in progress")).map(row => row.cells[1].value);
    let downloadUrls = batchRows.map(row => row.cells[10].value);
    res.send({downloadUrls, failedItems});
  })
  .catch((error) => {
    console.log(error);
    res.send({});
  });
});

//app error handling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.statusCode).json(err);
});
//#endregion

// start server
server.listen(PORT, () => {

  console.log(`Server listening on port ${PORT}`);
});