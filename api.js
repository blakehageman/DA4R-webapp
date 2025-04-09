const axios = require('axios');
const csv = require('csv-stringify');
const lx = require('luxon');
const fs = require('fs');
const qs = require('qs');
const decompress = require('decompress');

async function getAllContents(response, a, b, n, token3) {
    a = [];
    b = [];
    folders = [];
    items = [];
    //check and process data
    responseData = response.flat().map((item) => {return item.data.data}).flat();
  
    responseData.forEach((entity) => {
      switch (entity.type) {
        case 'folders':
          folders = folders.concat(entity);
          break;
        case 'items':
          items = items.concat(entity);
          break;
        default:
          console.log('Data fallthrough!');
      }
    });
  
    folders = processFolders(folders);
    items = processItems(items);
  
    a = a.concat(folders);
    b = b.concat(items);
  
    //if folders remain, recall function on folders
    if (folders.length>0) {
      const myResponse = await axios.all(folders.map((folder) => getFolderContents(folder, token3)))
      .then((response) => {
        n--;
        if (n>0) {
          return getAllContents(response, a, b, n, token3);
        }
        
      });
  
      if (myResponse !== undefined) {
        a = a.concat(myResponse[0]);
        b = b.concat(myResponse[1]);
      }
    }
    return [a, b];
}

async function getItemVersions(item, token) {
    const config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: 'https://developer.api.autodesk.com/data/v1/projects/' + item.projectId + "/items/" + item.id + "/versions",
        headers: { 
        'Authorization': 'Bearer ' + token
        }
    }
    return axios.request(config);
}

async function getFolderContents(folder, token) {
    const config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: 'https://developer.api.autodesk.com/data/v1/projects/' + folder.projectId + "/folders/" + folder.id + "/contents",
        headers: { 
            'Authorization': 'Bearer ' + token
        }
    }
    return axios.request(config);
}

async function searchFolderContents(folder, searchKey, token) {
    let queryString = "filter[fileType]=rvt&filter[name]-contains=" + searchKey;

    const config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: 'https://developer.api.autodesk.com/data/v1/projects/' + folder.projectId + "/folders/" + folder.id + "/search?" + queryString,
        headers: { 
            'Authorization': 'Bearer ' + token
        }
    }
    return axios.request(config);
}

function processVersions(versionsData) {
    versionNodes = versionsData.map(reformatVersionToNode);
    return versionNodes;
}

function processItems(itemsData) {
    itemNodes = itemsData.map(reformatToNode);
    return itemNodes;
}

function processFolders(folderData, topFolder=false) {
    //convert to node
    folderNodes = folderData.map(reformatToNode);

    //set parent as project if top folder, otherwise set as parent folder
    if (topFolder) {
    folderNodes = folderNodes.map((folderNode, i) => setNodeParent(folderNode, getProjectId(folderData[i])));
    }
    
    //return flat list - list can be flattened since parent data in contained in each node
    return folderNodes;
}

function processProjects(projectData) {
    let projectNodes = projectData.map(reformatToNode);

    projectNodes = projectNodes.map((node, i) => {
        node.parent = projectData[i].relationships.hub.data.id;
        return node;
    });

    return projectNodes;
}

async function getSmartsheet(smartsheet) {
    smartsheet.sheets.getSheet({
        id: "1404044853596036"
    })
    .then((sheet) => {
        console.log(`Loaded ${sheet.rows.length} rows from sheet ${sheet.name}`);

        var headers = sheet.columns.map((column) => {
            return column.title;
        });

        var data = sheet.rows.map((row) => {
            return row.cells.map((cell) => cell.value ?? "");
        });

        data.splice(0, 0, headers);

        csv.stringify(data, function(err, output) {
            fs.writeFile("./public/lookupTable.csv", output, 'utf8', function(err) {
                if (err) console.log(err)
                else console.log("--- Saved Smartsheet to local CSV ---")
            });
        });
    })
    .catch((error) => {
        console.log(error);
    });
}

async function logWorkItem(job) {
    var sheetId = "7143404232200068"; //workitem log sheet id
    var data;

    //single workitem
    if (!job.batch) {
        data = [
            {
                "toTop": true,
                "cells": [
                    {
                        "columnId": 3191546647105412, //submitted by
                        "value": job.user
                    },
                    {
                        "columnId": 3754496600526724, //workitem id
                        "value": job.id
                    },
                    {
                        "columnId": 8482293990510468, //batch id
                        "value": job.batchId
                    },
                    {
                        "columnId": 8414427668762500, //number in batch
                        "value": "1 of 1"
                    },
                    {
                        "columnId": 8258096227897220, //time submitted
                        "value": job.timeSubmitted
                    },
                    {
                        "columnId": 939746833420164, //time returned
                        "value": job.timeReturned ?? ""
                    },
                    {
                        "columnId": 7695146274475908, //activity
                        "value": job.script
                    },
                    {
                        "columnId": 7114358248132484, //file name
                        "value": job.fileName
                    },
                    {
                        "columnId": 5443346460790660, //work item status
                        "value": job.status
                    },
                    {
                        "columnId": 225845355433860, //s3 upload key
                        "value": job.uploadKey ?? ""
                    }
                ]
            }
        ];
    }
    //batch of workitems
    else {
        data = job.ids.map((id, i) => {
            return {
                "toTop": true,
                "cells": [
                    {
                        "columnId": 3191546647105412, //submitted by
                        "value": job.user
                    },
                    {
                        "columnId": 3754496600526724, //workitem id
                        "value": id
                    },
                    {
                        "columnId": 8482293990510468, //batch id
                        "value": job.batchId
                    },
                    {
                        "columnId": 8414427668762500, //number in batch
                        "value": `${i+1} of ${job.size}`
                    },
                    {
                        "columnId": 8258096227897220, //time submitted
                        "value": job.timeSubmitted
                    },
                    {
                        "columnId": 939746833420164, //time returned
                        "value": job.timeReturned != undefined ? job.timeReturned : "" 
                    },
                    {
                        "columnId": 7695146274475908, //activity
                        "value": job.script
                    },
                    {
                        "columnId": 7114358248132484, //file name
                        "value": job.fileNames[i]
                    },
                    {
                        "columnId": 5443346460790660, //work item status
                        "value": job.status
                    },
                    {
                        "columnId": 225845355433860, //s3 upload key
                        "value": job.uploadKeys[i] !== undefined ? job.uploadKeys[i] : ""
                    }
                ]
            }
        });
    }

    var config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: `https://api.smartsheet.com/2.0/sheets/${sheetId}/rows`,
        headers: { 
          'Authorization': 'Bearer fHhPrbLGkeW78XYWBDpU3SbzLhDHvjwCbPpLs', 
          'Content-Type': 'application/json'
        },
        data : data
    };

    return axios.request(config);
}

async function updateWorkItemLog(smartsheet, id, timeReturned, status, url) {
    var sheetId = "7143404232200068"; //workitem log sheet id
    var workItemColumnId = "3754496600526724"; //workitem id column

    smartsheet.sheets.getSheet({
        id: sheetId
    })
    .then((sheet) => {
        //lookup row with work item ID
        var myRow = sheet.rows.find((row) => {
            
            var myCell = row.cells.find((cell) => {
                return cell.columnId == workItemColumnId
            });

            if (myCell.value === id) {return true;}
            else {return false;}
        });

        //update time returned and status columns
        let data = {
            "id": myRow.id,
            "cells": [
                {
                    "columnId": 939746833420164, //time returned
                    "value": timeReturned
                },
                {
                    "columnId": 5443346460790660, //status
                    "value": status
                },
                {
                    "columnId": 6826322977312644, //download URL
                    "value": url
                }
            ]
        };

        let config = {
            method: 'put',
            maxBodyLength: Infinity,
            url: `https://api.smartsheet.com/2.0/sheets/${sheetId}/rows`,
            headers: { 
              'Authorization': 'Bearer fHhPrbLGkeW78XYWBDpU3SbzLhDHvjwCbPpLs', 
              'Content-Type': 'application/json'
            },
            data : data
        };
    
        return axios.request(config);
    })
    .catch((error) => {
        console.log(error);
    });
}

async function getWorkItemLog(smartsheet, user, days) {
    var sheetId = "7143404232200068"; //workitem log sheet id
    var userColumnId = "3191546647105412"; //user column
    var timeSubmittedId = "8258096227897220"; //time submitted column

    return smartsheet.sheets.getSheet({
        id: sheetId
    })
    .then((sheet) => {
        //filter rows for user jobs
        var myRows = sheet.rows.filter((row) => {
            
            var myCell = row.cells.find((cell) => {
                return cell.columnId == userColumnId
            });

            if (myCell.value === user) {return true;}
            else {return false;}
        });

        //filter rows for last n days
        var myRowsRecent = myRows.filter((row) => {            
            var myCell = row.cells.find((cell) => cell.columnId == timeSubmittedId);

            if (myCell.value != undefined) {
                var timeSubmitted = lx.DateTime.fromFormat(myCell.value, 'yyMMdd-HHmm');
                if (-timeSubmitted.diffNow('days').as('days')>days) {return false;} //omit rows submitted more than n days ago
                else {return true;}
            }
            else {return true;}
        });

        return myRowsRecent;
    })
    .catch((error) => {
        console.log(error);
    });
}

async function purgeWorkItemLog(smartsheet, days) {
    var sheetId = "7143404232200068"; //workitem log sheet id
    var timeSubmittedId = "8258096227897220"; //time submitted column

    smartsheet.sheets.getSheet({
        id: sheetId
    })
    .then((sheet) => {
        var rowsToDelete = sheet.rows.filter((row) => {            
            var myCell = row.cells.find((cell) => cell.columnId == timeSubmittedId);

            if (myCell.value != undefined) {
                var timeSubmitted = lx.DateTime.fromFormat(myCell.value, 'yyMMdd-HHmm');
                if (-timeSubmitted.diffNow('days').as('days')>days) {return true;} //delete rows submitted more than n days ago
                else {return false;}
            }
            else {return false;}
        });

        if (rowsToDelete.length > 0) {
            var options = {
                sheetId: sheet.id,
                queryParameters: {
                    ids: rowsToDelete.map((row) => row.id)
                }
            };
    
            smartsheet.sheets.deleteRows(options)
        }
    })
    .catch((error) => {
        console.log(error);
    });
}

async function refreshWorkItemUrl(smartsheet, rowId, url) {
    // specify updated cell values
    var row = [
        {
            "id": rowId,
            "cells": [
                {
                "columnId": 6826322977312644, //download url column
                "value": url
                }
            ]
        }
    ];
  
    // set options
    var options = {
        sheetId: "7143404232200068", //workitem log sheet id
        body: row
    };
  
    // update rows in sheet
    smartsheet.sheets.updateRow(options)
    .catch(function(error) {
        console.log(error);
    });
}

async function getWorkItemByID(smartsheet, workItemId) {
    return smartsheet.sheets.getSheet({
        id: "7143404232200068" //workitem log sheet id
    })
    .then((sheet) => {
        //find row with correct work item ID
        var myRow = sheet.rows.find((row) => row.cells[1].value == workItemId);

        //reconstruct job object from smartsheet log
        var myJob = {
            user : myRow.cells[0].value,
            id : myRow.cells[1].value,
            batchId : myRow.cells[2].value,
            batch : myRow.cells[3].value.split(" ")[2] == 1 ? false : true,
            timeSubmitted : myRow.cells[4].value,
            timeReturned : myRow.cells[5].value,
            script : myRow.cells[6].value,
            fileName : myRow.cells[7].value,
            status : myRow.cells[8].value,
            uploadKey : myRow.cells[9].value,
            downloadUrl : myRow.cells[10].value
        }

        myJob.oFile = myJob.script+"_"+myJob.fileName+"_"+myJob.timeSubmitted+".zip";

        return myJob;
    })
    .catch((error) => {
        console.log(error);
    });
}

async function getWorkItemBatchStatus(smartsheet, batchId) {
    return smartsheet.sheets.getSheet({
        id: "7143404232200068" //workitem log sheet id
    })
    .then((sheet) => {
        //find rows with correct batchId
        var myRows = sheet.rows.filter(row => row.cells[2].value == batchId);
        var inProgress = myRows.filter(row => row.cells[8].value == "in progress");
        var succeeded = myRows.filter(row => row.cells[8].value == "success")

        let batchStatus = {
            id: batchId,
            size: myRows.length,
            completed: myRows.length - inProgress.length,
            failed: myRows.length - inProgress.length - succeeded.length,
            finished: inProgress.length == 0 ? true : false
        }

        console.log("+++ Batch Status +++")
        console.log(batchStatus);

        return batchStatus;
    })
    .catch((error) => {
        console.log(error);
    });


}

async function getWorkItemBatch(smartsheet, batchId) {
    return smartsheet.sheets.getSheet({
        id: "7143404232200068" //workitem log sheet id
    })
    .then((sheet) => {
        //find rows with correct batchId
        var myRows = sheet.rows.filter((row) => row.cells[2].value == batchId);
        
        return myRows;
    })
    .catch((error) => {
        console.log(error);
    });
}

function getProjectId(item) {
return {'id': item.links.self.href.substring(52, 90)};
}

function getParent(item) {
return item.relationships.parent.data;
}

function reformatToNode(item) {
let types = [
    'folders:autodesk.bim360:Folder',
    'items:autodesk.bim360:File',
    'items:autodesk.bim360:C4RModel',
    'items:autodesk.bim360:FDX',
    'versions:autodesk.bim360:File',
]
let node = {
    'id' : item.id,
    'parent' : item.relationships.parent ? getParent(item).id : "#",
    'text' : item.attributes.name ? item.attributes.name : item.attributes.displayName,
    'type' : item.attributes.extension.type,
    'projectId': types.includes(item.attributes.extension.type) ? getProjectId(item).id : "DNA"
};
return node;
}

function reformatVersionToNode(item) {
node = {
    'id' : item.id,
    'parent' : item.relationships.item.data.id,
    'text' : item.attributes.displayName + "_v" + item.attributes.versionNumber,
    'type' : item.attributes.extension.type,
    'projectId': getProjectId(item).id,
    'viewerURN' : item.relationships.derivatives ? item.relationships.derivatives.data.id : null,
    'fileGuid': item.relationships.storage ? item.relationships.storage.data.id : null,
    'projectGuid' : item.attributes.extension ? item.attributes.extension.data.projectGuid : null,
    'modelGuid' : item.attributes.extension ? item.attributes.extension.data.modelGuid : null
};
return node;
}

function setNodeParent(child, parent) {
child.parent = parent.id;
return child;
}

async function refreshTokens(refresh_token) {
    console.log("... refreshing token ...");
  
    const data = qs.stringify({
      'grant_type': 'refresh_token',
      'refresh_token': refresh_token
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

    let flag = false;
    
    let response = await axios.request(config)

    if (response) {
        return {
            token: response.data.access_token,
            refresh_token: response.data.refresh_token
        }
    }
}

async function checkTokens(req, res) {
    //refresh if required
    if (!req.cookies.token && req.cookies.refresh) {
        let refreshResponse = await refreshTokens(req.cookies.refresh)

        if (refreshResponse) {
            let token3 = refreshResponse.token;
        
            res.cookie('token', token3, {maxAge: 1000 * 60 * 59, httpOnly: true}); 
            res.cookie('refresh', refreshResponse.refresh_token);
    
            return {
                token: token3,
                response: res
            }
        };
    }
    //else do nothing
    else {
        return {
            token: req.cookies.token,
            response: res
        }
    }
}

async function oauth2legged(scopes) {
    let data = qs.stringify({
        'grant_type': 'client_credentials',
        'scope': scopes.internal_2legged 
    });

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://developer.api.autodesk.com/authentication/v2/token',
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded', 
          'Authorization': 'Basic ' + btoa(process.env.FORGE_CLIENT_ID+":"+process.env.FORGE_CLIENT_SECRET),
        },
        data : data
    };

    return axios.request(config)
}

async function getBuckets(token) {
    let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: 'https://developer.api.autodesk.com/oss/v2/buckets',
        headers: { 
            'Authorization': 'Bearer '+ token, 
            'Content-Type': 'application/json'
        },
    };



    return axios.request(config)
}

async function createBucket(bucketKey, token) {
    let bucketData = {
        "bucketKey": bucketKey,
        "access": "full",
        "policyKey": "temporary"
    };

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://developer.api.autodesk.com/oss/v2/buckets',
        headers: { 
          'Authorization': 'Bearer '+token, 
          'Content-Type': 'application/json'
        },
        data: bucketData
    };

    return axios.request(config)
}

async function getObjectUploadUrl(bucketKey, objectKey, token) {
    let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload?minutesExpiration=60`,
        headers: { 
            'Authorization': `Bearer ${token}`
        }
    }

    return axios.request(config);
}

async function getObjectDownloadUrl(bucketKey, objectKey, token) {
    let minutesExpiration = 60;

    let config = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3download?minutesExpiration=${minutesExpiration}`,
        headers: { 
            'Authorization': 'Bearer '+token 
        }
    };

    return axios.request(config)
}

async function getModelDownloadUrl(model, token) {
    let objectKey = model.fileGuid.split('\/')[1];

    let data = qs.stringify({
    "bucketKey": "wip.dm.prod",
    "objectKey": objectKey
    });

    let config = {
    method: 'get',
    maxBodyLength: Infinity,
    url: 'https://developer.api.autodesk.com/oss/v2/buckets/wip.dm.prod/objects/' + objectKey + '/signeds3download?response-content-disposition=attachment',
    headers: { 
        'Authorization': 'Bearer '+ token
    },
    data: data
    };

    return axios.request(config);
}

async function postObjectUpload(bucketKey, objectKey, uploadKey, token) {
    // if uploadkey, then signed uploads were used; upload must be "completed"
    if (uploadKey !== undefined) {
        let config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectKey}/signeds3upload`,
            headers: { 
              'Authorization': 'Bearer ' + token, 
              'Content-Type': 'application/json'
            },
            data : {
                'uploadKey': uploadKey
            }
        };
    
        return axios.request(config);
    }
    // if no uploadkey, then signed uploads were not used; pass through function without doing anything.
    else return undefined;
}

async function submitWorkitem(script, model, options) {
    /*
    structure of options arg is as follows

    options = {
        environment: {
            oauthCallback,
            workitemCallback,
            workitemBatchCallback,
            appUrl   
        },
        batch,
        token2,
        token3,
        objectKey,
        uploadParams: {
            uploadKey
            uploadUrl
        },
        downloadUrl,
        signedUploads,
        appVariables: {
            webhook_url,
            endpoint,
            app_alias
        },
        loadFromCloud,
        includeLinks,
        scriptAlias
    }
    */
    let workitemBody;

    if (options.loadFromCloud == "true") {
        workitemBody = {
            activityId: options.appVariables.app_alias+'.'+script+'+'+options.scriptAlias,
            arguments: {
                inputCSV : {
                    verb: "get",
                    url : options.environment.appUrl+"lookupTable.csv",
                },
                inputJSON : {
                    url: `data:application/json, {\"loadFromCloud\": \"true\", \"projectGuid\": \"${model.projectGuid}\", \"modelGuid\": \"${model.modelGuid}\", \"objectKey\": \"${options.objectKey}\", \"fileName\": \"${model.text}\", \"includeLinks\": \"${options.includeLinks}\"}`
                },
                outputZIP : {
                    verb: "put",
                    url: options.uploadParams.uploadUrl,
                    localName: options.objectKey,
                    headers: {
                        "Authorization": "Bearer "+options.token2
                    }
                },
                onComplete : {
                    verb: "post",
                    url: options.batch ? options.environment.workitemBatchCallback : options.environment.workitemCallback
                },
                adsk3LeggedToken: options.token3
            },
            limitProcessingTimeSec: 43200
        };
    }
    else {
        workitemBody = {
            activityId: options.appVariables.app_alias+'.'+script+'+'+options.scriptAlias,
            arguments: {
                inputRVT : {
                    verb: "get",
                    url: options.downloadUrl
                },
                inputCSV : {
                    verb: "get",
                    url : options.environment.appUrl+"lookupTable.csv",
                },
                inputJSON : {
                    url: `data:application/json, {\"loadFromCloud\": \"false\", \"projectGuid\": \"${model.projectGuid}\", \"modelGuid\": \"${model.modelGuid}\", \"objectKey\": \"${options.objectKey}\", \"fileName\": \"${model.text}\", \"includeLinks\": \"${options.includeLinks}\"}`
                },
                outputZIP : {
                    verb : "put",
                    url : options.uploadParams.uploadUrl,
                    localName: options.objectKey,
                    headers: {
                        "Authorization": "Bearer "+options.token2
                    }
                },
                onComplete : {
                    verb: "post",
                    url: options.batch ? options.environment.workitemBatchCallback : options.environment.workitemCallback
                },
                adsk3LeggedToken: options.token3
            },
            limitProcessingTimeSec: 21600
        }
    }

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://developer.api.autodesk.com/da/us-east/v3/workitems',
        headers: { 
            'Authorization': 'Bearer '+options.token2,
            'Content-Type': 'application/json'
        },
        data : workitemBody
    };

    return axios.request(config);
}

async function saveWorkItemResults(smartsheet, gcs, url) {
    var unzipFolder;
    var smartsheetFolder;
    var fileList;

    //ensure output folder exists (server)
    checkCreateOutputFolder("./output");

    //download result .zip
    saveOutputFromUrl(url)
    //then unzip file
    .then((zipPath) => {
        unzipFolder = zipPath.slice(0,-4);

        return decompress(zipPath, unzipFolder)
    })
    //then post new folder to smartsheet
    .then((files) => {
        fileList = files;

        console.log(fileList.map(file => file.path));
        // console.log("Current directory: ", process.cwd());
        // fs.readdirSync(process.cwd()).forEach(file => {
        //     console.log("--- "+file);
        // });

        var i = unzipFolder.indexOf("_");
        smartsheetFolder = unzipFolder.slice(i+1);

        if (smartsheetFolder.length > 50) {
            smartsheetFolder = smartsheetFolder.replace(".rvt","");
        }

        if (smartsheetFolder.length > 50) {
            smartsheetFolder.substring(0, 50); //force truncate (for now)
        }

        return postFolderToSmartsheet(smartsheet, smartsheetFolder);
    })
    //then post unzipped files to new folder
    .then((folder) => {
        fileList.forEach(file => {
            var fullPath = `${unzipFolder}/${file.path}`;
            // console.log(file.path);
            postCsvToSmartsheet(smartsheet, file.path.slice(0,-4), fullPath, folder.result.id);

            //post only instances file to GCS
            if (file.path.includes("instances.csv")) {
                postCsvToGoogleCloud(gcs, 'wevr-datalake', fullPath)
            }
            
        });
    })
    .catch(function(error) {
        console.log(error);
    });
}

async function postCsvToGoogleCloud(gcs, bucketId, filePath) {
    const fileName = filePath.split('/')[1];
    const bucket = gcs.bucket(bucketId);
    const file = bucket.file(fileName);

    fs.createReadStream(filePath)
        .pipe(file.createWriteStream())
        .on('error', function(err) {
            // The file upload failed.
        })
        .on('finish', function() {
            // The file upload is complete.
        });
}

async function purgeOutputFolder() {
    var folder = "./output";

    if (fs.existsSync(folder)) {
        var content = fs.readdirSync(folder);

        console.log(`Deleting ${content.length} files/directories from OUTPUT`);
        
        content.forEach(item => {
            var path = `${folder}/${item}`;
    
            console.log(item);
            console.log(path);
    
            if (item.endsWith(".zip")) {
                fs.rmSync(path);
            }
            else {
                fs.rmSync(path, { recursive: true });
            }
        });
    }
}

async function saveOutputFromUrl(url) {
    let config = {
        method: 'get',
        responseType: "arraybuffer",
        url: url
    };

    var fileName = getFileNameFromUrl(url);
    var path = `output/${fileName}`

    console.log(`Saving file ${fileName}`)

    return new Promise((resolve, reject) => {
        axios.request(config)
        .then((response) => {
            var file = fs.createWriteStream(path);
            
            file.write(response.data, () => {
                file.close(() => {
                    console.log(`Saved file to ${path}`);
                    resolve(path);
                });
            });
        })
        .catch(function(error) {
            console.log(error);
            resolve(undefined);
        });
    });
}

async function postCsvToSmartsheet(smartsheet, sheetName, filePath, folderId) {
    var options = {
        folderId: folderId,
        queryParameters: {
            sheetName: sheetName,
            headerRowIndex: 0,
        },
        path: filePath
    };
    
    smartsheet.sheets.importCsvSheetIntoFolder(options)
    .then(function(attachment) {
    })
    .catch(function(error) {
        console.log(error);
    });
}

async function postFolderToSmartsheet(smartsheet, folderName) {
    var options = {
        folderId: "983276409120644", //output folder
        body: {
            "name": folderName
        }
    }

    return smartsheet.folders.createChildFolder(options)
    .then((newFolder) => {
        return newFolder;
    })
    .catch(function(error) {
        console.log(error);
        return undefined;
    });
}

function getFileNameFromUrl(url) {
    var decoded = decodeURIComponent(url);

    var stringPrefix = "filename=";
    var stringSuffix = ".zip";

    var prefixIndex = decoded.indexOf(stringPrefix);
    var decodedSliced = decoded.slice(prefixIndex + stringPrefix.length); //do not include prefix
    var suffixIndex = decodedSliced.indexOf(stringSuffix);
    var substring = decodedSliced.slice(0, suffixIndex + stringSuffix.length); //do include suffix

    //clean up quotes if necessary (when file name contains spaces)
    if (substring.startsWith("\"")) {
        substring = substring.slice(1);
        substring = substring.trim();
    }

    return substring;
}

function checkCreateOutputFolder(folderName) {
    try {
        if (!fs.existsSync(folderName)) {
            fs.mkdirSync(folderName);
        }
    }
    catch (err) {
        console.error(err);
    }
}

module.exports = {
    reformatToNode,
    processProjects,
    processFolders,
    processItems,
    searchFolderContents,
    getFolderContents,
    getAllContents,
    getSmartsheet,
    getItemVersions,
    processVersions,
    checkTokens,
    oauth2legged,
    getBuckets,
    createBucket,
    getObjectUploadUrl,
    getObjectDownloadUrl,
    postObjectUpload,
    submitWorkitem,
    getModelDownloadUrl,
    logWorkItem,
    updateWorkItemLog,
    getWorkItemLog,
    purgeWorkItemLog,
    refreshWorkItemUrl,
    getWorkItemByID,
    getWorkItemBatchStatus,
    getWorkItemBatch,
    saveWorkItemResults,
    purgeOutputFolder
}