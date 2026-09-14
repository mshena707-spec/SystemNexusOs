const fetch = require('node-fetch');
async function test() {
  const largeString = 'a'.repeat(2 * 1024 * 1024); // 2MB
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: 'customer', message: largeString, history: [] })
  });
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Body:", text.substring(0, 100));
}
test();
