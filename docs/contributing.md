# Contributing to Alga PSA

Thank you for your interest in contributing to Alga PSA! We appreciate contributions of all kinds, whether it's fixing bugs, improving documentation, suggesting new features, or helping other users.

## Ways to Contribute

- **Report bugs**: Open an issue describing the problem and steps to reproduce it
- **Suggest features**: Share ideas for new functionality via GitHub issues
- **Submit code**: Fix bugs or implement new features via pull requests
- **Improve documentation**: Help make our docs clearer and more comprehensive
- **Help others**: Answer questions in discussions and issues

## Getting Started

1. **Fork the repository** and clone it locally
2. **Set up your development environment** following the [Setup Guide](getting-started/setup_guide.md)
3. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

## Development Guidelines

- Follow existing code patterns and conventions in the codebase
- See [Configuration Standards](getting-started/configuration_standards.md) for config conventions
- Write tests for new functionality and ensure existing tests pass:
  ```bash
  npm run test
  ```

## NX Modules (Monorepo)

Alga PSA uses NX + npm workspaces. Shared infrastructure lives in **horizontal** packages (e.g. `@alga-psa/core`, `@alga-psa/db`, `@alga-psa/types`), while business domains live in **vertical** packages (e.g. `@alga-psa/clients`, `@alga-psa/billing`).

### Create a New Module

Use the generator (recommended):

```bash
NX_DAEMON=false npx nx g @alga-psa/generators:alga-module --name <module-name> --type vertical --directory packages
```

This creates `packages/<module-name>/` with `src/`, `package.json`, `tsconfig.json`, and `project.json`.

### Dependency Rules

- Vertical modules may import **horizontal** modules (`@alga-psa/*` infra packages).
- Vertical modules should **not** import other vertical modules directly.
- Next.js routes remain under `server/src/app/` but should be **thin shims** that import from feature packages.
- Keep exports intentional: prefer a module `src/index.ts` barrel and avoid deep imports unless explicitly supported.

## Submitting Changes

### Pull Request Process

1. **Update your branch** with the latest changes from `main`
2. **Test your changes** thoroughly
3. **Write a clear PR description** explaining:
   - What the change does
   - Why it's needed
   - Any breaking changes or considerations
4. **Link related issues** using keywords like "Fixes #123"

### Commit Messages

Write clear, concise commit messages that explain what changed and why:

```
feat: add automatic time tracking for ticket views

fix: resolve billing calculation error for quarterly cycles

docs: update setup guide with new environment variables
```

## Reporting Issues

When reporting bugs, please include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- Your environment (OS, browser, Node version)
- Relevant logs or screenshots

## Questions?

If you have questions about contributing, feel free to open a discussion on GitHub. We're here to help you get started.

---

Thank you for helping make Alga PSA better!
