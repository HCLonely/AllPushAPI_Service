import { execSync } from 'node:child_process';

const provider = process.env.DATABASE_PROVIDER || 'sqlite';
const suffix = provider === 'postgresql' ? '.postgresql' : '';
const schema = `apps/api/prisma/schema${suffix}.prisma`;

const args = process.argv.slice(2);
execSync(`npx prisma ${args.join(' ')} --schema=${schema}`, { stdio: 'inherit' });
