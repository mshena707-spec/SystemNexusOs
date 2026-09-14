const fs = require('fs');

const files = [
  'src/components/admin/OmnichannelHubApp.tsx',
  'src/components/admin/SecurityBotApp.tsx',
  'src/components/admin/FleetManagerApp.tsx',
  'src/components/admin/CTOChatApp.tsx',
  'src/components/admin/ChatMonitorApp.tsx',
  'src/components/admin/OrderManagerApp.tsx',
  'src/components/admin/TraceViewerApp.tsx',
  'src/pages/RiderDashboard.tsx',
  'src/pages/Marketplace.tsx',
  'src/pages/RepDashboard.tsx'
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  
  // Find onSnapshot(q, (snapshot) => { ... });
  // Regex to match the end of the snapshot callback and add the error callback
  // It's a bit tricky because the callback end with `});`
  // We can just add `.catch`? No, `onSnapshot` returns an unsubscribe function.
  // The signature is onSnapshot(query, (snapshot) => {...}, (error) => {...})
  
  // Let's do a simple string replacement based on `unsubscribe = onSnapshot`
  
  const modified = content.replace(/(\s*set([A-Za-z]+)\(.*?;\n\s*\}\);)/g, (match, p1) => {
     // Check if this appears to be the end of onSnapshot
     if (match.includes('});')) {
        return match.replace('});', '}, (error) => { console.error("Snapshot error:", error); });');
     }
     return match;
  });
  
  if (modified !== content) {
    fs.writeFileSync(file, modified);
    console.log('Patched', file);
  } else {
    // try finding just the end of the snapshot callback
    const lines = content.split('\n');
    let insideSnapshot = false;
    let braceCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("import ") && lines[i].includes("firebase/firestore")) {
            lines.splice(i+1, 0, "import { handleFirestoreError, OperationType } from '../../firebase'; // Added by auto-patcher");
            break;
        }
    }

    insideSnapshot = false;
    braceCount = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('unsubscribe = onSnapshot(')) {
            insideSnapshot = true;
            let partial = lines[i].substring(lines[i].indexOf('('));
            braceCount += (partial.match(/\{/g) || []).length;
            braceCount -= (partial.match(/\}/g) || []).length;
        } else if (insideSnapshot) {
            braceCount += (lines[i].match(/\{/g) || []).length;
            braceCount -= (lines[i].match(/\}/g) || []).length;
            
            if (braceCount === 0 && lines[i].includes('}, (error) => { console.error("Snapshot error:", error); });')) {
                lines[i] = lines[i].replace('}, (error) => { console.error("Snapshot error:", error); });', '}, (error) => { handleFirestoreError(error, OperationType.GET, "unknown_path"); });');
                insideSnapshot = false;
            }
        }
    }
    fs.writeFileSync(file, lines.join('\n'));
    console.log('Patched via line iter', file);
  }
}
