#!/usr/bin/env node
// Refreshes the Writing and Shipped blocks in README.md from live sources.
// Writes nothing and exits 0 when any source is unavailable, so a flaky
// upstream never leaves the README half-updated or fails the workflow.

import { readFile, writeFile } from 'node:fs/promises';

const README = new URL('../README.md', import.meta.url);
const ZENN_USER = 'satoyoshi';
const ARTICLE_COUNT = 5;

const SHIPPED = [
  {
    name: 'MagPoint',
    url: 'https://chromewebstore.google.com/detail/mcflgbjfkamejadmpepkjbndfaakbndl',
    description:
      'Chrome extension that pulls the cursor toward the nearest clickable element. Pointing assist, not a cursor skin. [Source](https://github.com/satocchi0416sh/magpoint)',
    version: { source: 'chrome-web-store', id: 'mcflgbjfkamejadmpepkjbndfaakbndl' },
  },
  {
    name: 'moji-sand',
    url: 'https://apps.apple.com/jp/app/id6780945669',
    description: 'A word game you can play once a day. React Native, on the App Store.',
  },
  {
    name: 'cortex',
    url: 'https://github.com/satocchi0416sh/cortex',
    description: 'Go CLI that idempotently syncs local AI memory files into Notion, running under launchd.',
    version: { source: 'github-release', repo: 'satocchi0416sh/cortex' },
  },
  {
    name: 'dotgo',
    url: 'https://github.com/satocchi0416sh/dotgo',
    description: 'Tag-based dotfiles manager. One `dotgo.yaml`, no directory gymnastics.',
    version: { source: 'github-release', repo: 'satocchi0416sh/dotgo' },
  },
  {
    name: 'typed-notion-cli',
    url: 'https://github.com/satocchi0416sh/typed-notion-cli',
    description: 'Generates type-safe TypeScript schemas from Notion data sources.',
  },
];

class SourceError extends Error {}

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'satocchi0416sh-profile-readme',
      accept: 'application/json',
      ...(process.env.GITHUB_TOKEN && url.startsWith('https://api.github.com/')
        ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!response.ok) throw new SourceError(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

function replaceBlock(markdown, name, body) {
  const pattern = new RegExp(`(<!-- ${name}:START -->)[\\s\\S]*?(<!-- ${name}:END -->)`);
  if (!pattern.test(markdown)) throw new SourceError(`marker ${name} not found in README`);
  return markdown.replace(pattern, `$1\n\n${body}\n\n$2`);
}

async function buildWriting() {
  const data = await getJson(`https://zenn.dev/api/articles?username=${ZENN_USER}&order=latest`);
  const articles = data?.articles;
  if (!Array.isArray(articles) || articles.length === 0) throw new SourceError('zenn returned no articles');

  // Zenn silently ignores an unknown username and answers with the site-wide
  // feed, so an unverified response would publish other people's posts here.
  // Authored publication posts still carry the author in user.username.
  const mine = articles.filter((a) => a?.user?.username === ZENN_USER);
  if (mine.length === 0) throw new SourceError(`zenn returned no articles authored by ${ZENN_USER}`);

  // Most-read first: the newest posts are not the ones worth leading with.
  return mine
    .slice()
    .sort((a, b) => b.liked_count - a.liked_count || b.published_at.localeCompare(a.published_at))
    .slice(0, ARTICLE_COUNT)
    .map((a) => `- ♥ ${a.liked_count} &nbsp;[${a.title}](https://zenn.dev${a.path})`)
    .join('\n');
}

// A missing release is a normal state for a repo, so resolve to null instead of
// throwing — only transport failures should abort the whole run.
async function resolveVersion(spec) {
  if (!spec) return null;
  try {
    if (spec.source === 'github-release') {
      const release = await getJson(`https://api.github.com/repos/${spec.repo}/releases/latest`);
      return release?.tag_name ?? null;
    }
    if (spec.source === 'chrome-web-store') {
      const badge = await getJson(`https://img.shields.io/chrome-web-store/v/${spec.id}.json`);
      return badge?.value ?? null;
    }
  } catch (error) {
    if (error instanceof SourceError) return null;
    throw error;
  }
  return null;
}

// A list, not a table: GitHub sizes table columns from their content, so a long
// description column squeezes the project column until some name wraps mid-word.
async function buildShipped() {
  const versions = await Promise.all(SHIPPED.map((item) => resolveVersion(item.version)));
  return SHIPPED.map((item, index) => {
    const version = versions[index] ? ` \`${versions[index]}\`` : '';
    return `- **[${item.name}](${item.url})**${version} — ${item.description}`;
  }).join('\n');
}

async function main() {
  const original = await readFile(README, 'utf8');
  const [writing, shipped] = await Promise.all([buildWriting(), buildShipped()]);

  let updated = replaceBlock(original, 'WRITING', writing);
  updated = replaceBlock(updated, 'SHIPPED', shipped);

  if (updated === original) {
    console.log('README already up to date');
    return;
  }
  await writeFile(README, updated);
  console.log('README updated');
}

try {
  await main();
} catch (error) {
  if (error instanceof SourceError || error instanceof TypeError) {
    // TypeError covers fetch network failures.
    console.warn(`skipped: ${error.message}`);
    process.exit(0);
  }
  throw error;
}
