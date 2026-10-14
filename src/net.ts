import net from 'node:net';

// Node's default 250ms per-address connect window is shorter than the ~300ms round trip to Neon us-east-2.
net.setDefaultAutoSelectFamilyAttemptTimeout(2000);
