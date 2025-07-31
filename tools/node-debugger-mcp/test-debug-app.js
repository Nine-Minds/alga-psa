// Test application for debugging
console.log('Debug test app started');

let counter = 0;

// Function to demonstrate debugging
function incrementCounter() {
  counter++;
  console.log(`Counter: ${counter}`);
  return counter;
}

// Function with a potential bug
function calculateValue(x, y) {
  const result = x * y + 10;
  console.log(`Calculating: ${x} * ${y} + 10 = ${result}`);
  return result;
}

// Main loop
setInterval(() => {
  incrementCounter();
  const value = calculateValue(counter, 2);
  
  if (counter % 5 === 0) {
    console.log('Milestone reached:', counter);
  }
}, 2000);

console.log('Test app is running. Use debugger to inspect.');