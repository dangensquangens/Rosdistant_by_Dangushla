document.getElementById('open').addEventListener('click',async()=>{
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 await chrome.tabs.create({url:chrome.runtime.getURL('export.html')+(tab?.id?'?source='+tab.id:''),active:true});
 window.close();
});
