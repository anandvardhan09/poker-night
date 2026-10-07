import { spawn } from 'node:child_process';

const procs = [
  ['server', '\x1b[36m', ['run', 'dev', '-w', '@pk/server']],
  ['web', '\x1b[35m', ['run', 'dev', '-w', '@pk/web']],
].map(([name, color, args]) => {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: ['inherit', 'pipe', 'pipe'] });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (buf) =>
      out.write(
        buf
          .toString()
          .split('\n')
          .filter((l, i, a) => l || i < a.length - 1)
          .map((l) => prefix + l)
          .join('\n') + '\n',
      ),
    );
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

function shutdown(code) {
  for (const p of procs) if (p.exitCode === null) p.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
