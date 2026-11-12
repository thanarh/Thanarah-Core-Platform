import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Prisma migration catalog', () => {
  it('contains a nonempty SQL file in every migration directory', () => {
    const root = 'prisma/migrations';
    const directories = readdirSync(root, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );
    expect(directories.length).toBeGreaterThan(0);
    for (const directory of directories) {
      const file = join(root, directory.name, 'migration.sql');
      expect(statSync(file).isFile(), `${directory.name} must contain migration.sql`).toBe(true);
      expect(readFileSync(file, 'utf8').trim(), `${directory.name} must not be empty`).not.toBe('');
    }
  });
});
