const { spawn } = require('child_process');
const INDEX_PATH = '../index.mjs';

const child = spawn('node', [INDEX_PATH, '-p', 'run sleep'], {
  env: {
    ...process.env,
    OPENAI_BASE_URL: 'http://127.0.0.1:12345',
    OPENAI_API_KEY: 'test-key',
  }
});

child.stdout.on('data', d => console.log('out', d.toString()));
child.stderr.on('data', d => console.log('err', d.toString()));
child.on('close', code => console.log('exit code', code));
setTimeout(() => {
  console.log('Sending SIGINT');
  child.kill('SIGINT');
}, 1000);
