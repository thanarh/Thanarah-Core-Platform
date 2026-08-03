/**
 * @deprecated Use PrismaService directly.
 *
 * This file is kept as a re-export shim so that any future code referencing
 * DatabaseService continues to compile during the migration window.
 * Remove once all consumers have been updated to inject PrismaService.
 */
export { PrismaService as DatabaseService } from './prisma.service';
