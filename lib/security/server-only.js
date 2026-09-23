/**
 * Guard for server-only modules. Keep this file free of imports that pull
 * browser-incompatible or circular dependencies.
 */

export function assertServerOnly() {
  if (typeof window !== 'undefined') {
    throw new Error('This security helper is server-only');
  }
}
