//global variables
var batchFiles;
var socket = io();

//run on site load
$(document).ready(function () {
    $('.resizable').resizable();

    //#region SOCKET IO
    socket.on('connect', function() {
        setUserName();
    });

    //single response success
    socket.on('result', function(url) {
        const wait = document.getElementById('await');
        const failure = document.getElementById('failure');

        wait.style.display = 'none';
        failure.style.display = 'none';

        //reset download button to clear previous 'click' event triggers
        $('#success').replaceWith($('#success').clone());
        const success = document.getElementById('success');
        success.style.display = 'inline-block';

        success.addEventListener("click", function() {
            window.open(url);
        });
    })

    //single response failure
    socket.on('failure', function(workItemId) {
        const wait = document.getElementById('await');
        const success = document.getElementById('success');

        wait.style.display = 'none';
        success.style.display = 'none';

        //reset download button to clear previous 'click' event triggers
        $('#failure').replaceWith($('#failure').clone());
        const failure = document.getElementById('failure');
        failure.style.display = 'inline-block';

        failure.addEventListener("click", function() {
            getReport(workItemId);
        });
    });

    //batch update
    socket.on('update', function() {
        const batchStatus = document.getElementById('batch-status');

        //delay fetching status to allow smartsheet to finish updating
        setTimeout(() => {
            jQuery.ajax({
                url: '/work-item/batch-status'
            })
            .then((status) => {  
                batchStatus.innerText = status.completed +" of "+ status.size +" Complete, "+status.failed+" Failed";
                if (status.finished) {
                    getBatchResults();
                }
            });
        }, 2000);
    });
    //#endregion

    //control panel toggle   
    const setBatch = document.getElementById('batch-opt');

    setBatch.addEventListener('input', function() {
        if (setBatch.checked) {
            document.getElementById('single-model').style.display="none";
            document.getElementById('batch-model').style.display="flex";
            document.getElementById('model-picker-label').textContent = "Select Target Models";
        }
        else {
            document.getElementById('single-model').style.display="flex";
            document.getElementById('batch-model').style.display="none";
            document.getElementById('model-picker-label').textContent = "Select Target Model";
        }
    });

    //#region LINK MAPPER

    //drag and drop file
    const dropzone = document.querySelector(".dropzone");

    dropzone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        setActive(dropzone);
    });
      
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        setActive(dropzone);
    });
      
    dropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        setActive(dropzone, false);
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        setActive(dropzone, false);
        var files = e.dataTransfer.files;
        var file = files[0];

        loadFile(file);
    });

    //file upload from disk
    const fileInput = document.querySelector('.file-input');
    fileInput.addEventListener('change', (e) => {
        var files = e.target.files;
        var file = files[0];
        
        loadFile(file);
    });

    // prevent the drag & drop on the page
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());

    //#endregion
});

//#region AJAX functions
function setUserName() {
    jQuery.ajax({
        url: '/user-profile',
    })
    .then((data) => {
        if (data.name !== undefined) {
            $("#userInfo").html("Signed in as " + data.name);

            $("#autodeskSignOutButton").css("display","block");
            $("#autodeskSignInButton").css("display","none");
            $('#build-tree-button').css("cursor", "pointer");
            $('#build-tree-button').css("color", "#000");
        }
        else {
            $("#autodeskSignOutButton").css("display","none");
            $("#autodeskSignInButton").css("display","block");
            $('#build-tree-button').css("display, none");
        }
        let user = data.email ? data.email : 'none';

        if (data.email) {
            socket.emit('data', data.email);
        }

        console.log("User logged in: " + user);
    });
}

function resetUser() {
    jQuery.ajax({
        url: './user-reset'
    })
    .done(() => {
        document.getElementById('autodeskSignOutButton').style.display = 'none';
        document.getElementById('autodeskSignInButton').style.display = 'block';
    
        location.reload(true);
    });
}

function loadTree() {
    var loadButton = document.getElementById("build-tree-button");
    loadButton.onclick = undefined; //temp disable onclick to prevent multiple overlapping requests

    setTimeout(() => { //enable onclick after 3s
        loadButton.onclick = loadTree;
    }, 3000);

    jQuery.ajax({
        method: 'GET',
        url: './acc-data/rootFolders',
        // error: function(jqXHR, exception) {
        //     errorHandler (jqXHR, exception, loadTree)
        // }
    })
    .then((data) => {
        // console.log(data); //for debugging

        buildTree(data);
        loadButton.onclick = loadTree; //enable onclick after results return
    })
    .catch((error) => {
        console.log(error);
    });
}

function getFolderContents(node) {
    jQuery.ajax({
        type: "POST",
        url: './acc-data/folderContents',
        headers: {
            "Content-Type": "application/json"
        },
        data: JSON.stringify(node.original),
        error: function(jqXHR, exception) {
            errorHandler (jqXHR, exception, getFolderContents.bind(null, node));
        }
    })
    .then((data) => {
        reloadTree(data);
    })
    .catch((error) => {
        console.log(error);
    });
}

function searchFolderContents(node, searchString) {
    if (searchString.length>0) {
        jQuery.ajax({
            type: "POST",
            url: './acc-data/folderSearch',
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({
                node: node.original,
                searchString: searchString
            }),
            error: function(jqXHR, exception) {
                errorHandler (jqXHR, exception, searchFolderContents.bind(null, node));
            }
        })
        .then((items) => {
            if (items !== undefined) {
                var folder = createVirtualFolder(node.original, searchString);

                if (Array.isArray(items)) {
                    items.forEach(item => {
                        item.parent = folder.id;    
                    });
    
                    items.push(folder);

                    reloadTree(items);
                }
                else if (typeof items == "object") {
                    items.parent = folder.id;
                    items = [items, folder];

                    reloadTree(items);
                }
                else {
                    console.log("no search results");
                }
                console.log(items);
            }
            else {
                console.log("no search results");
            }
        })
        .catch((error) => {
            console.log(error);
        });
    }
}

function getVersions(nodes, getAll = false) {
    let data;
    
    if (Array.isArray(nodes)) { //more than one input node
        data = nodes.map((node) => node.original);
    }
    else { //only one input node
        data = [nodes.original]
    }

    jQuery.ajax({
        type: "POST",
        url: './acc-data/itemVersions',
        headers: {
            "Content-Type": "application/json"
        },
        data: JSON.stringify({data: data, getAll: getAll}),
        error: function(jqXHR, exception) {
            errorHandler (jqXHR, exception, getVersions.bind(null, nodes, getAll))
        }
    })
    .then((data) => {
        reloadTree(data);
    })
    .catch((error) => {
        console.log(error);
    });
}

function getReport(workItemId) {
    //console.log(`Fetching report for workitem ${workItemId}`);

    jQuery.ajax({
        type: "POST",
        url: './work-item/report',
        headers: {
            "Content-Type": "application/json"
        },
        data: JSON.stringify({workItem : workItemId}),
        error: function(jqXHR, exception) {
            errorHandler (jqXHR, exception, getFailureReport.bind(null, workItemId))
        }
    })
    .then((urls) => {
        if (urls != undefined) {
            window.open(urls.reportUrl);

            if (urls.debugUrl !== undefined) {
                window.open(urls.debugUrl);
            }
        }
    })
    .catch((error) => {
        console.log(error);
    });
}

function getJobs() {
    jQuery.ajax({
        url: '/recent-jobs',
    })
    .then((data) => {
        // console.log("Recent Jobs:")
        // console.log(data);

        var table = document.getElementById("recent-jobs-table");
        clearJobs(table);

        data.forEach((job) => {
            addJobToTable(job, table);
        })
    });
}

function refreshDownloadUrls() {
    jQuery.ajax({
        url: '/recent-jobs/refresh-urls',
    })
    .then((status) => {
        if (status == "success") {
            getJobs();
        }
    });
}

function getBatchResults() {
    const wait = document.getElementById('await');

    //reset download button to clear previous 'click' event triggers
    $('#batch-download').replaceWith($('#batch-download').clone());
    const batchDownload = document.getElementById('batch-download');

    //get batch results
    jQuery.ajax({
        url: '/work-item/batch-result'
    })
    .then((response) => {
        console.log(response);

        wait.style.display = 'none';
        batchDownload.style.display = 'inline-block';
    
        //change button style on result
        if(response.failedItems.length === 0) {
            //complete success
            batchDownload.innerText = 'Success — Download Results';
            batchDownload.style.color = '#034b09';
            batchDownload.style.backgroundColor = '#c2e1cb';
        }
        else if (response.downloadUrls.length === 0) {
            //complete failure
            batchDownload.innerText = 'Failure — Download Reports';
            batchDownload.style.color = '#4b0303';
            batchDownload.style.backgroundColor = '#e1c2c2';
        }
        else {
            //mixed results
            batchDownload.innerText = 'Partial Success — Download Results';
            batchDownload.style.color = '#795600';
            batchDownload.style.backgroundColor = '#f1e0b4';
        }
    
        batchDownload.addEventListener("click", function() {
            response.failedItems.forEach((workItemId) => {
                getReport(workItemId);
            })
            response.downloadUrls.forEach((url)=>{
                window.open(url);
            });
        });
    });


}

function executeAutomation(flag) {
    const wait = document.getElementById('await');
    const complete = document.getElementById('complete');
    const success = document.getElementById('success');
    const failure = document.getElementById('failure');
    const batchDownload = document.getElementById('batch-download');
    const script = document.getElementById('select-automation').value;
    const loadFromCloud = document.getElementById('cloud-load').checked;
    const includeLinks = document.getElementById('include-links').checked;

    if (!flag) { //run as single item
        const modelId = document.getElementById('select-model').value;
        const treeData = $('#jstree-container').jstree(true)._model.data;
        const model = treeData[modelId].original;

        //submit options to server at work-item route
        jQuery.ajax({
            url: './work-item/submit',
            data: {
                "script": script,
                "model" : model,
                "loadFromCloud" : loadFromCloud,
                "includeLinks" : includeLinks
            },
            error: function(jqXHR, exception) {
                errorHandler (jqXHR, exception, executeAutomation.bind(null, flag))
            }
        })
        .then((response) => {
            document.getElementById('batch-status').innerText = "";
            if (response === "success") {
                wait.style.display = 'inline-block';
                complete.style.display = 'none';
                success.style.display = 'none';
                failure.style.display = 'none';
                batchDownload.style.display = 'none';
                if (wait.innerText !== "Awaiting Result...") {
                    wait.innerText = 'Awaiting Result...'
                    wait.style.color = '#9b9b9b';
                    wait.style.backgroundColor = '#eeeeee';
                }
            }
            else if (response === "failure") {
                wait.style.display = 'inline-block';
                wait.innerText = 'Automation Failed to Start'
                wait.style.color = '#4b0303';
                wait.style.backgroundColor = '#e1c2c2';
                complete.style.display = 'none';
                success.style.display = 'none';
                failure.style.display = 'none';
                batchDownload.style.display = 'none';
            }
        })
    }
    else { //run as batch
        let models = batchFiles.map((node) => node.original);

        //submit options to server at work-item route
        jQuery.ajax({
            url: './work-item/submit-batch',
            data: {
                "script": script,
                "models": models,
                "loadFromCloud": loadFromCloud,
                "includeLinks": includeLinks
            }
        })
        .then((response) => {
            if (response === "success") {
                wait.style.display = 'inline-block';
                complete.style.display = 'none';
                success.style.display = 'none';
                failure.style.display = 'none';
                batchDownload.style.display = 'none';
                document.getElementById('batch-status').innerText = "0 of "+models.length+" Complete";

                if (wait.innerText !== "Awaiting Result...") {
                    wait.innerText = 'Awaiting Result...'
                    wait.style.color = '#9b9b9b';
                    wait.style.backgroundColor = '#eeeeee';
                }
            }
            else if (response === "failure") {
                wait.style.display = 'inline-block';
                wait.innerText = 'Automation Failed to Start'
                wait.style.color = '#4b0303';
                wait.style.backgroundColor = '#e1c2c2';
                complete.style.display = 'none';
                success.style.display = 'none';
                failure.style.display = 'none';
                batchDownload.style.display = 'none';
            }
        })
    }
}

function errorHandler(jqXHR, exception, callback) {
    if (jqXHR.status === 401) {
        //refresh token and try again
        refreshToken(callback);
    }
    else {
        errorModal(jqXHR.status);
    }
}
//#endregion

//#region jsTree functions
function buildTree(data) {   
    //console.log(data);
    data.sort((a,b) => a.text.localeCompare(b.text));

    //build new jsTree file viewer
    $('#jstree-container').jstree({
        'core' : {
            'data' : data,
            'themes': {
                'dots': false
            }
        },
        'types': {
            'hubs:autodesk.bim360:Account': {
                'icon': './assets/icon-cloud.png'
            },
            'hubs:autodesk.core:Hub': {
                'icon': './assets/icon-project.png'
            },
            'hubs:autodesk.a360:PersonalHub': {
                'icon': './assets/icon-user.png'
            },
            'projects:autodesk.bim360:Project': {
                'icon': './assets/icon-database.png'
            },
            'projects:autodesk.core:Project': {
                'icon': './assets/icon-database.png'
            },
            'folders:autodesk.bim360:Folder': {
                'icon': './assets/icon-folder.png'
            },
            'items:autodesk.bim360:File': {
                'icon': './assets/icon-files.png'
            },
            'items:autodesk.bim360:C4RModel': {
                'icon': './assets/icon-files.png'
            },
            'items:autodesk.bim360:Document': {
                'icon': './assets/icon-files.png'
            },
            'items:autodesk.bim360:FDX': {
                'icon': './assets/icon-files.png'
            },
            'versions:autodesk.bim360:File': {
                'icon': './assets/icon-document.png'
            },
            'versions:autodesk.bim360:C4RModel': {
                'icon': './assets/icon-document.png'
            },
            'versions:autodesk.bim360:FDX': {
                'icon': './assets/icon-document.png'
            },
            'searchResult': { //custom type defined for search results
                'icon': './assets/icon-search.png'
            }
        },
        'checkbox' : {
            'three_state' : false,
            'whole_node' : false,
            'cascade' : "down"
        },
        'contextmenu' : {
            'items' : customMenu
        },
        'plugins' : [
            'checkbox',
            'types',
            'contextmenu',
            'search'
        ]
    })
    .bind("activate_node.jstree", function(event, data) {
        //start file viewer on activate of version node
        if (data != null && data.node != null &&
            (
                data.node.original.type === "versions:autodesk.bim360:File"
                ||
                data.node.original.type === "versions:autodesk.bim360:C4RModel"
                ||
                data.node.original.type === "versions:autodesk.bim360:FDX"
            ))
        {
            if (data.node.original.viewerURN) {
                launchViewer(data.node.original.viewerURN);
            }
            else {
                let text = document.getElementById('init-text');
                text.style.color = "black";
                text.style.fontWeight = "bold";
                text.innerText = "Version selected not associated with cloud-viewable file.";
            }
        }

        batchFiles = getBatchFromTree();
    });

    // console.log($('#jstree-container').jstree(true));

    $('#jstree-container').bind("dblclick.jstree", function(event) {
        //load contents on double click of unloaded folder/item
        var tree = $(this).jstree();
        var node = tree.get_node(event.target);
        
        if (node.children.length==0) {
            if (node.type.startsWith("folders")) {
                getFolderContents(node);
                node.state.opened = true;
            }
            else if (node.type.startsWith("items")) {
                getVersions(node);
                node.state.opened = true;
            }
        }
    });

    updateControlPanel(data);
}

function reloadTree(data) {
    let treeData = structuredClone($('#jstree-container').jstree(true).settings.core.data);
    treeData = treeData.concat(data);
    treeData.reverse();

    //cull duplicates, keep latest
    treeIds = treeData.map((item) => item.id);
    filteredTreeData = treeData.filter((node, i) => {
        return treeIds.indexOf(node.id) === i;
    });

    filteredTreeData.reverse();
    
    $('#jstree-container').jstree(true).settings.core.data = filteredTreeData;
    $('#jstree-container').jstree(true).refresh(true);

    updateControlPanel(filteredTreeData);
}

function updateControlPanel (data) {
    //remove old data from dropdown on tree reload
    let modelOptions = document.getElementById('select-model').options;
    l = modelOptions.length;
    if (l > 1) {
        for (let i=1; i < l; i++) { //modelOptions updates on each iteration of loop, so always remove index 1
            modelOptions.remove(1);
        }           
    }

    //add new data to dropdown
    data.forEach((item) => {
        if ((item.type === "versions:autodesk.bim360:File" || item.type === "versions:autodesk.bim360:C4RModel") && item.text.match(/\.rvt/gm)) {
            //single model dropdown
            $("#select-model").append($('<option>', {
                text: item.text,
                value: item.id
            }));
        }
    });

    //update controls
    let elements = document.getElementsByClassName('tree-control')
    Array.prototype.forEach.call(elements, (e) => {e.style.display = 'block';});
    document.getElementById('build-tree-button').style.display = 'none'; 
}

function customMenu (node) {
    var items = {
        'getFolderContents' : {
            'label' : 'Load Folder Content',
            'action' : function () {
                getFolderContents(node);
            }
        },
        'getLatestVersion' : {
            'label' : 'Get Latest Version of Item',
            'action' : function () {
                getVersions(node);
            }
        },
        'getAllVersions' : {
            'label' : 'Get All Versions of Item',
            'action' : function () {
                getVersions(node, true);
            }
        },
        'getChildrenVersions' : {
            'label' : 'Get Latest Version of Contents',
            'action' : function () {
                if (node.type === 'folders:autodesk.bim360:Folder') {
                    let items = [];
                    let nodes = $('#jstree-container').jstree(true)._model.data;
    
                    node.children_d.forEach((childId) => {
                        child = nodes[childId];
                        if (child.type.includes('items')) {
                            items.push(child);
                        }
                    });
    
                    getVersions(items);
                }
            }
        },
        'searchFolder' : {
            'label' : 'Search Folder Contents',
            'action' : function () {
                var searchString = document.getElementById("browser-search").value;
                searchFolderContents(node, searchString);
            }
        },
        'default' : {
            'label' : 'No Action Available',
            'action' : function() {},
            '_disabled' : true
        }
    }

    //if folder
    if (node.type === 'folders:autodesk.bim360:Folder') {
        delete items.getLatestVersion;
        delete items.getAllVersions;
        delete items.default;
        //has no item children
        if (!hasItemChildren(node)) {
            delete items.getChildrenVersions;
        }
    }
    // else if item
    else if (node.type.startsWith("items")) {
        delete items.getFolderContents;
        delete items.getChildrenVersions;
        delete items.default;
        delete items.searchFolder;
    }
    // else default
    else {
        delete items.getFolderContents;
        delete items.getLatestVersion;
        delete items.getAllVersions;
        delete items.getChildrenVersions;
        delete items.searchFolder;
    }

    return items;
}

function expandTree(n=undefined) {
    if (n === undefined) {
        $('#jstree-container').jstree("open_all");
    }
    else {
        let tree = $('#jstree-container');
        let nodes = tree.jstree(true)._model.data;
        let nodeIds = Object.keys(nodes).reverse(); //reverse keys so that opening a node does not chain down to next level

        nodeIds.forEach((nodeId) => {
            let node = nodes[nodeId];
            let isClosed = tree.jstree('is_closed', node);
            let isInDOM = isNodeInDOM(nodeId);

            if (isClosed && isInDOM) {
                tree.jstree('open_node', node);
            }

        });

        if (n > 1) {
            expandTree(n-1);
        }
    }
}

function collapseTree(n=undefined) {
    if (n === undefined) {
        $('#jstree-container').jstree("close_all");
    }
    else {
        let tree = $('#jstree-container');
        let nodes = tree.jstree(true)._model.data;
        let nodeIds = Object.keys(nodes);
        let maxGenInDOM = 0;

        //find maximum generation in DOM
        nodeIds.forEach((nodeId) => {
            let isInDOM = isNodeInDOM(nodeId);
            let gen = nodes[nodeId].parents.length;
            if (isInDOM && gen > maxGenInDOM) {
                maxGenInDOM = gen
            }
        });

        //close all parents of max generation
        nodeIds.forEach((nodeId) => {
            let node = nodes[nodeId];
            let nodeGen = node.parents.length;
            let isOpen = !(tree.jstree('is_closed', node));
            let isInDOM = isNodeInDOM(nodeId);

            if (isOpen && (nodeGen === maxGenInDOM-1) && isInDOM) {
                tree.jstree('close_node', node);
            }
        });

        if (n > 1) {
            collapseTree(n-1);
        }
    }
}

function getBatchFromTree() {
    let batchFiles = [];
    nodes = $('#jstree-container').jstree("get_bottom_selected", true);
    
    nodes.forEach((node) => {
        if ((node.type == "versions:autodesk.bim360:File" || node.type == "versions:autodesk.bim360:C4RModel") && node.text.match(/\.rvt/gm)) {
            batchFiles.push(node);
        }
    });

    let x = batchFiles.length;
    document.getElementById('select-model-batch').innerText = x+" Selected in File Browser";
    updateExecuteButton()

    return batchFiles;
}

function isNodeInDOM(id) {
    e = document.getElementById(id);
    if (e !== null) {
        return true;
    }
    else {
        return false;
    }
}

function hasItemChildren(node) {
    if (node.children_d !== undefined) {
        let flag = false;
        node.children_d.every((childId) => {
            if (childId.includes('lineage')) {
                flag = true;
                return false;
            }
            else {
                return true;
            }
        })

        if (flag) {
            return true;
        }
        else {
            return false;
        }
    }
    else {
        return false;
    }
}

function treeSearch() {
    var searchValue = document.getElementById("browser-search").value;
    $('#jstree-container').jstree("search", searchValue);
}

function createVirtualFolder(parentNode, searchString) {
   
    return {
        id: parentNode.id + ":" + searchString,
        parent: parentNode.id,
        text: "search for: "+searchString,
        type: "searchResult",
        projectId: parentNode.projectId
    };
}

//#endregion

//#region link map functions

function setActive(dropzone, active=true) {
    // active class
    const hasActiveClass = dropzone.classList.contains('dropzone-active');
    
    if (active && !hasActiveClass) {
        return dropzone.classList.add('dropzone-active');
    }
    
    if (!active && hasActiveClass) {
        return dropzone.classList.remove('dropzone-active');
    }

}

function loadFile(file) {
    var reader = new FileReader();
    reader.readAsText(file);

    reader.onload = function(e) {
        var csv = e.target.result;
        var linkRecords = $.csv.toObjects(csv);
        var header = document.querySelector(".link-map-header");

        header.innerHTML = `
            <div class="link-map-header-section">
                <span id="link-map-file-name">Showing link map for <strong>${file.name}</strong></span>
                <button id="link-map-file-clear" onclick="clearLinkMap()">Clear</button>
            </div>
            <div class="link-map-header-section">
                <span class="legend">● = attachment link</span>
                <span>○ = overlay link</span>
            </div>

        `;

        document.querySelector(".dropzone").style.display = "none";
        header.style.display = "block";
        document.querySelector(".link-map-body").style.display = "flex";

        loadLinkMap(file, linkRecords);
    }
}

function loadLinkMap(file, linkRecords) {
    //create container for jsTree
    const div = document.createElement('div');
    div.id = 'link-map-jstree'
    document.querySelector('.link-map-body').appendChild(div);

    //alphabetical sort
    linkRecords.sort((a,b) => a.FileName.localeCompare(b.FileName));

    //format for jsTree
    linkRecords.forEach((record) => {
        record.id = record.TypeId;
        record.parent = record.ParentId;
        record.text = record.FileName;
        record.type = record.AttachmentType;
        record.state = {
            disabled: true
        }
    });

    //add root node
    var root = {
        id: "-1",
        parent: "#",
        text: file.name.replace("_linkMap.csv",".rvt"),
        type: "Root",
        state: {
            opened : true,
            disabled: true
        }
    }
    linkRecords.push(root);

    //cull duplicates
    const data = [...new Map(linkRecords.map(record => {
        return [`${record['parent']}:${record['id']}`, record]
    })).values()];

    //build new jsTree file viewer
    $('#link-map-jstree').jstree({
        'core' : {
            'data' : data,
            'themes': {
                'dots': false
            }
        },
        'types': {
            'Root': {
                'icon': './assets/icon-document.png'
            },
            'Attachment': {
                'icon': './assets/attachment.svg'
            },
            'Overlay': {
                'icon': './assets/overlay.svg'
            }
        },
        'plugins' : [
            'types'
        ]
    });
}

function clearLinkMap() {
    //clear loaded file
    var input = document.querySelector(".file-input");
    input.value = "";

    //reset UI
    document.querySelector(".link-map-header").style.display = "none";
    document.querySelector(".link-map-body").style.display = "none";
    document.querySelector(".dropzone").style.display = "flex";

    //clear jsTree
    document.getElementById('link-map-jstree').remove()
}

//#endregion

//#region UI functions

window.onclick = function(event) {
    const modals = document.getElementsByClassName("modal");
    var activeModal;
    
    for (modal of modals) {
        if (modal.style.display == "block") {
            activeModal = modal;
            if (event.target == activeModal) {
                activeModal.style.display = "none";
            }
        }   
    }
}

function displayModal(i) {
    document.getElementById(i).style.display = "block";
}

function hideModal(i) {
    document.getElementById(i).style.display = "none";
}

function errorModal(status) {
    document.getElementById('error-msg').innerText = "Error " + status;
    displayModal('error-modal');
}

function launchViewer(urn) {
    jQuery.ajax({
        url: './token',
    })
    .then((token) => {
        var options = {
            env: 'AutodeskProduction2',
            api: 'streamingV2',
            accessToken: token
        };
    
        Autodesk.Viewing.Initializer(options, function onInitialized() {
            viewer = new Autodesk.Viewing.GuiViewer3D(document.getElementById('viewer'), {});
            viewer.start();
            var documentId = "urn:" + urn;
            Autodesk.Viewing.Document.load(documentId, onDocumentLoadSuccess, onDocumentLoadFailure);
        });

        //search model objects
        var search = document.getElementById("search");
        var searchId = document.getElementById("search-id");
        var searchInput = document.getElementById("search-input");
        var searchClear = document.getElementById("search-clear");

        search.style.display = "inline-block";
        searchId.style.display = "inline-block";
        searchInput.style.display = "inline-block";
        searchClear.style.display = "inline-block";

        search.addEventListener("click", function () {
            viewer.search(document.getElementById("search-input").value, function(dbIds) {
                viewer.model.getProperties(dbIds[0], function(properties) {
                    console.log(properties);
                });

                viewer.isolate(dbIds);
                viewer.fitToView(dbIds);
            });
        });

        searchId.addEventListener("click", function() {
            var elementId = document.getElementById("search-input").value;

            viewer.model.getObjectTree((tree) => {
                let dbIds = tree.nodeAccess.nodes;
                dbIds = Array.from(new Set(dbIds)).sort();
    
                findNodeByElementId(viewer, dbIds, elementId)
                .then((dbId) => {
                    if (dbId === undefined) {
                        console.log(`Model object matching Element ID ${elementId} not found.`)
                    }
                    else {
                        viewer.isolate(dbId);
                        viewer.fitToView(dbId);
                    }
                })
            })
        });

        searchClear.addEventListener("click", function () {
            viewer.isolate();
            viewer.fitToView();
            searchInput.value="";
        });
    });
}

function onDocumentLoadSuccess(doc) {
    var viewables = doc.getRoot().getDefaultGeometry();

    viewer.loadDocumentNode(doc, viewables).then(model => {
        //do stuff on load
    });
    
    viewer.loadExtension('Autodesk.DocumentBrowser');
    viewer.loadExtension('Autodesk.Section');
}

function onDocumentLoadFailure(viewerErrorCode) {
    console.error('Document load faiure. ErrorCode: ' + viewerErrorCode);
}

async function findNodeByElementId(viewer, nodeIds, match) {
    return new Promise((resolve) => {
        nodeIds.forEach(nodeId => {
            viewer.getProperties(nodeId, nodeProperties => {
                var hexString = nodeProperties.externalId.slice(-8);
                var elementId = parseInt(hexString, 16);

                if (elementId == match) {
                    resolve(nodeId);
                }
            });
        });

        //return promise as "failed" after 5 seconds
        setTimeout(() => {
            resolve(undefined);
        }, (5000));
    });
}

function isBatch() {
    return document.getElementById('batch-opt').checked;
}

function includeLinks() {
    return document.getElementById('include-links').checked;
}

function updateExecuteButton() {
    const automation = document.getElementById("select-automation");
    const model = document.getElementById("select-model");
    const models = document.getElementById("select-model-batch");
    const execute = document.getElementById("execute");

    //execute button is only active when automation and target model have valid values
    //resets execute button on automation submit
    if (isBatch()) {
        if (automation.value.includes("none") || models.innerText.includes("0 Selected")) {
            execute.classList.remove("ready");
            execute.classList.remove("clickable");
            execute.classList.add("waiting");

            execute.onclick = undefined;
        }
        else {
            execute.classList.add("ready");
            execute.classList.add("clickable");
            execute.classList.remove("waiting");

            execute.onclick = function() {
                executeAutomation(isBatch())
                
                //reset execute to prevent double-submit
                document.getElementById('select-automation').value = "none";
                execute.classList.remove("ready");
                execute.classList.remove("clickable");
                execute.classList.add("waiting");
            };
        }
    }
    else {
        if (automation.value.includes("none") || model.value.includes("none")) {
            execute.classList.remove("ready");
            execute.classList.remove("clickable");
            execute.classList.add("waiting");

            execute.onclick = undefined;
            
        }
        else {
            execute.classList.add("ready");
            execute.classList.add("clickable");
            execute.classList.remove("waiting");

            execute.onclick = function() {
                executeAutomation(isBatch());

                //reset execute to prevent double-submit
                document.getElementById('select-automation').value = "none";
                execute.classList.remove("ready");
                execute.classList.remove("clickable");
                execute.classList.add("waiting");
            }
        }
    }
}

function addJobToTable(job, table) {
    var myRow = table.insertRow();

    myRow.insertCell().innerHTML = job[6].value; //automation
    myRow.insertCell().innerHTML = job[7].value; //file
    myRow.insertCell().innerHTML = job[4].value; //time submitted
    myRow.insertCell().innerHTML = job[5].value != undefined ? job[5].value : ""; //time returned
    myRow.insertCell().innerHTML = job[8].value; //status

    //download URL
    if (job[8].value == "success") {
        var btn = document.createElement('button');
        btn.innerHTML = "Result";
        btn.classList.add("recents-download","recents-result","clickable");

        myRow.insertCell().appendChild(btn);

        btn.onclick = function() {
            location.href=job[10].value;
        }
    }
    else {
        var btn = document.createElement('button');
        btn.innerHTML = "Report";

        if (job[8].value == "in progress") {
            btn.classList.add("recents-download","recents-report-waiting","clickable");
        }
        else {
            btn.classList.add("recents-download","recents-report-failed","clickable");
        }

        myRow.insertCell().appendChild(btn);

        btn.onclick = function() {
            getReport(job[1].value);
        }
    }
}

function clearJobs(table) {
    var rowsToDelete = table.rows.length-1;

    for (i=0; i<rowsToDelete; i++) {
        table.deleteRow(-1);
    }
}
//#endregion