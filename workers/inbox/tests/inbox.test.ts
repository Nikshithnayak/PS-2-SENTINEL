import assert from 'node:assert/strict';
import test from 'node:test';
import { extractReplyBodyText, parseReplyIntent } from '../src/index.ts';

test('extracts reply command from quoted RFC822 caregiver email without quotes', () => {
  const raw = [
    'From: kavitha@sentinel.local',
    'Subject: Re: SENTINEL Warning',
    '',
    'CALL ME',
    '',
    '> On Nov 25 SENTINEL wrote:',
    '> Notable change detected.',
  ].join('\r\n');

  const body = extractReplyBodyText(raw);
  assert.equal(body, 'CALL ME');
  assert.equal(parseReplyIntent(body), 'CALL ME');
  assert.equal(parseReplyIntent('ok thanks'), 'OK');
  assert.equal(parseReplyIntent('snooze 2h'), 'SNOOZE');
});
