// Simple test file for debugging
console.log('Test debug simple starting...');

function testFunction(x) {
  console.log('In testFunction with x =', x);
  return x * 2;
}

// Run a simple loop
let counter = 0;
setInterval(() => {
  counter++;
  const result = testFunction(counter);
  console.log(`Counter: ${counter}, Result: ${result}`);
}, 3000);

console.log('Test app is running. PID:', process.pid);