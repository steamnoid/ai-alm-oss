import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_PATH,
  isBoardUrl,
  isOnIdAtlassian,
  parseColumnsArgs,
  parseProvisionArgs,
  parseRepoRef,
  parseSessionArgs,
  repoKey,
} from '../../src/aialm/oss/board/flags.ts';

describe('parseRepoRef', () => {
  it('splits owner/repo', () => {
    expect(parseRepoRef('steamnoid/wellbeing-tracker-public')).toEqual({ owner: 'steamnoid', repo: 'wellbeing-tracker-public' });
  });

  it('throws on missing or extra slashes', () => {
    expect(() => parseRepoRef('justname')).toThrow(/owner\/name/);
    expect(() => parseRepoRef('a/b/c')).toThrow(/owner\/name/);
  });
});

describe('repoKey', () => {
  it('derives the project key from the repo name', () => {
    expect(repoKey('steamnoid/wellbeing-tracker-public')).toBe('WELLBEINGT');
  });
});

describe('parseProvisionArgs (board:create)', () => {
  it('defaults dry=false', () => {
    const a = parseProvisionArgs([]);
    expect(a.dry).toBe(false);
    expect(a.repo).toBe('');
  });

  it('parses --repo and --dry', () => {
    const a = parseProvisionArgs(['--repo=acme/widgets', '--dry']);
    expect(a.repo).toBe('acme/widgets');
    expect(a.dry).toBe(true);
  });
});

describe('parseSessionArgs (board:session)', () => {
  it('defaults headless/session and disables dry', () => {
    const a = parseSessionArgs([]);
    expect(a.headless).toBe(true);
    expect(a.session).toBe(DEFAULT_SESSION_PATH);
    expect(a.dry).toBe(false);
    expect(a.repo).toBe('');
  });

  it('parses --repo, --headless=false and --dry', () => {
    const a = parseSessionArgs(['--repo=acme/widgets', '--headless=false', '--dry']);
    expect(a.repo).toBe('acme/widgets');
    expect(a.headless).toBe(false);
    expect(a.dry).toBe(true);
  });
});

describe('parseColumnsArgs (board:columns)', () => {
  it('defaults headless/session and disables dry', () => {
    const a = parseColumnsArgs([]);
    expect(a.headless).toBe(true);
    expect(a.session).toBe(DEFAULT_SESSION_PATH);
    expect(a.dry).toBe(false);
    expect(a.repo).toBe('');
  });

  it('parses --repo, --headless=false and --dry', () => {
    const a = parseColumnsArgs(['--repo=acme/widgets', '--headless=false', '--dry']);
    expect(a.repo).toBe('acme/widgets');
    expect(a.headless).toBe(false);
    expect(a.dry).toBe(true);
  });
});

describe('URL helpers', () => {
  it('isOnIdAtlassian detects the Atlassian identity flow (login and join/user-access)', () => {
    expect(isOnIdAtlassian('https://id.atlassian.com/login?continue=x')).toBe(true);
    expect(isOnIdAtlassian('https://id.atlassian.com/join/user-access')).toBe(true);
    expect(isOnIdAtlassian('https://paligakrzychu.atlassian.net/jira/your-work')).toBe(false);
  });

  it('isBoardUrl detects an actual board page', () => {
    expect(isBoardUrl('https://paligakrzychu.atlassian.net/jira/software/projects/WELLBEINGT/boards/69')).toBe(true);
    expect(isBoardUrl('https://paligakrzychu.atlassian.net/jira/software/projects/WELLBEINGT/summary')).toBe(false);
  });
});
