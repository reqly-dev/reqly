# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report them privately via GitHub:
**Security → Report a vulnerability** on this repository
([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Include the affected version, platform, steps to reproduce and the impact you expect. You will get an
acknowledgement within a few days; fixes are released as a new version and credited in the advisory unless you
prefer otherwise.

## Supported versions

Only the latest release receives security fixes. The desktop app updates itself (Settings → Updates).

## Scope

Reqster runs a local HTTP server that the desktop window talks to. Areas we consider security-relevant include:

- the local server guard (Host / Origin checks, the per-session token) — DNS rebinding, CSRF, access by other local
  users or web pages;
- the script sandbox (`isolated-vm` in a separate process) — escapes, access to the file system, network or host
  process;
- secret variables leaking into history, logs or exports;
- the update channel (signature verification of updates).

Running the Linux build on a network without an authenticating proxy in front of it is out of scope: Reqster has no
login of its own by design (see the README).
