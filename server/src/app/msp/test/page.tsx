'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';

const dungeonRooms = [
  { href: '/msp/test/ui-kit', name: 'The Armory of Components', description: 'Inspect the full arsenal of UI artifacts' },
  { href: '/msp/test/collab', name: 'The Scrying Pool', description: 'Peer into the collaborative editing waters' },
  { href: '/msp/test/onboarding', name: 'The Welcome Chamber', description: 'Where new adventurers begin their journey' },
];

const dndClasses = [
  'Wandering Wizard',
  'Rogue Sysadmin',
  'Paladin of Uptime',
  'Cleric of Cloud Services',
  'Bard of Bug Reports',
  'Ranger of Remote Access',
  'Warlock of Workflows',
  'Barbarian of Backups',
  'Druid of Databases',
  'Monk of Monitoring',
  'Sorcerer of SLAs',
  'Fighter of Firewalls',
];

const greetings = [
  'Hail, brave adventurer! You have discovered the hidden chamber of Alga the Octopus.',
  'Well met, traveler! Few find their way to this secret alcove.',
  'By the eight tentacles! A visitor approaches!',
  'The waters shimmer as you step into the lair of Alga, Keeper of Tickets.',
  'A wild Alga appears! It seems... friendly?',
];

const quests = [
  'Your quest: Deploy the artifact before the next full moon (sprint deadline).',
  'A dragon (critical ticket) has been spotted in the production realm!',
  'The ancient scrolls (documentation) remain unwritten. Will you take up the quill?',
  'Legend speaks of a mythical "zero-bug release." Many have sought it. None have found it.',
  'The tavern keeper whispers of a merge conflict in the Forbidden Repository...',
  'A mysterious NPC offers you a side quest: refactor the legacy dungeon.',
];

function roll(max: number): number {
  return Math.floor(Math.random() * max);
}

export default function TestPage() {
  const [diceResult, setDiceResult] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [playerClass, setPlayerClass] = useState('');
  const [quest, setQuest] = useState('');
  const [tentacleWave, setTentacleWave] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setGreeting(greetings[roll(greetings.length)]);
    setPlayerClass(dndClasses[roll(dndClasses.length)]);
    setQuest(quests[roll(quests.length)]);
    setMounted(true);

    const interval = setInterval(() => {
      setTentacleWave(prev => !prev);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const rollD20 = () => {
    setRolling(true);
    setDiceResult(null);
    setTimeout(() => {
      setDiceResult(Math.floor(Math.random() * 20) + 1);
      setRolling(false);
    }, 600);
  };

  if (!mounted) {
    return <div className="lair-page" />;
  }

  return (
    <div className="lair-page">
      {/* Floating bubbles */}
      <div className="lair-bubbles">
        {Array.from({ length: 15 }).map((_, i) => {
          const size = 8 + (i % 5) * 6;
          return (
            <div
              key={i}
              className="lair-bubble"
              style={{
                width: `${size}px`,
                height: `${size}px`,
                left: `${5 + (i * 6.3) % 88}%`,
                animationDuration: `${6 + (i % 4) * 2}s`,
                animationDelay: `${i * 0.7}s`,
              }}
            />
          );
        })}
      </div>

      <div className="lair-content">
        {/* Octopus logo with wizard hat */}
        <div
          className="lair-mascot"
          style={{
            transform: tentacleWave ? 'rotate(-2deg)' : 'rotate(2deg)',
          }}
        >
          {/* Wizard hat */}
          <svg
            width="65"
            height="65"
            viewBox="0 0 50 50"
            className="lair-hat"
          >
            <polygon points="25,2 8,48 42,48" className="lair-hat-cone" />
            <polygon points="25,2 8,48 42,48" fill="url(#hatGradient)" />
            <circle cx="25" cy="15" r="3" className="lair-hat-star" opacity="0.8" />
            <circle cx="18" cy="30" r="2" className="lair-hat-star" opacity="0.5" />
            <circle cx="32" cy="25" r="1.5" className="lair-hat-star" opacity="0.6" />
            <ellipse cx="25" cy="48" rx="22" ry="4" className="lair-hat-brim" />
            <defs>
              <linearGradient id="hatGradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(138,77,234,0.3)" />
                <stop offset="100%" stopColor="rgba(45,27,105,0.1)" />
              </linearGradient>
            </defs>
          </svg>

          {/* The Alga octopus logo */}
          <img
            src="/avatar-purple-no-shadow.svg"
            alt="Alga the Octopus"
            width={120}
            height={135}
            className="lair-logo"
          />
        </div>

        {/* Title scroll */}
        <div className="lair-card lair-title-card">
          <h1 className="lair-title">
            The Lair of Alga the Wise
          </h1>
          <p className="lair-greeting">
            {greeting}
          </p>
        </div>

        {/* Character info */}
        <div className="lair-card">
          <div className="lair-label">Character Sheet</div>
          <div className="lair-stat">
            <span className="lair-stat-key">Class:</span> {playerClass}
          </div>
          <div className="lair-stat">
            <span className="lair-stat-key">Location:</span> The Secret Test Realm
          </div>
          <div className="lair-stat">
            <span className="lair-stat-key">Quest:</span>{' '}
            <span className="lair-greeting">{quest}</span>
          </div>
        </div>

        {/* D20 roller */}
        <div className="lair-card" style={{ textAlign: 'center' }}>
          <Button
            id="roll-d20"
            onClick={rollD20}
            disabled={rolling}
            style={{ fontFamily: 'Georgia, serif', letterSpacing: '0.05em' }}
          >
            {rolling ? 'Rolling...' : 'Roll the D20'}
          </Button>

          {diceResult !== null && (
            <div style={{ marginTop: '1rem' }}>
              <span className={`lair-dice ${diceResult === 20 ? 'lair-dice-crit' : diceResult === 1 ? 'lair-dice-fail' : ''}`}>
                {diceResult}
              </span>
              <div className="lair-greeting" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                {diceResult === 20 && 'NATURAL 20! Critical success! The deployment gods smile upon you.'}
                {diceResult === 1 && 'Critical fail... You accidentally mass-replied to a client email.'}
                {diceResult > 1 && diceResult < 20 && diceResult >= 15 && 'A solid roll. Your pull request is approved with no comments.'}
                {diceResult > 1 && diceResult < 15 && diceResult >= 10 && 'Decent. The build passes, but there are warnings.'}
                {diceResult > 1 && diceResult < 10 && diceResult >= 5 && 'The tests are flaky today. Try again after coffee.'}
                {diceResult > 1 && diceResult < 5 && 'Your IDE crashes. Roll for initiative.'}
              </div>
            </div>
          )}
        </div>

        {/* Dungeon rooms — links to test pages */}
        <div className="lair-card">
          <div className="lair-label">Dungeon Map — Rooms to Explore</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {dungeonRooms.map((room) => (
              <Link key={room.href} href={room.href} className="lair-room-link">
                <div className="lair-room-name">{room.name}</div>
                <div className="lair-room-desc">{room.description}</div>
              </Link>
            ))}
          </div>
        </div>

        {/* Footer wisdom */}
        <p className="lair-footer">
          &ldquo;In the realm of managed services, the octopus with eight arms resolves the most tickets.&rdquo;
          <br />
          — Alga, probably
        </p>
      </div>

      <style>{`
        /* ---- Base layout ---- */
        .lair-page {
          display: flex;
          align-items: flex-start;
          justify-content: center;
          font-family: Georgia, serif;
          padding: 2rem 2rem 4rem;
          position: relative;
          flex: 1 0 auto;
          min-height: 100%;
          /* Light: bright water — white base with subtle cyan wash */
          background: linear-gradient(
            135deg,
            rgb(var(--color-background)) 0%,
            rgb(var(--color-secondary-50) / 0.7) 40%,
            rgb(var(--color-secondary-100) / 0.3) 100%
          );
        }

        /* Dark: deep space purple */
        .dark .lair-page {
          background: linear-gradient(
            135deg,
            rgb(var(--color-primary-50) / 0.4) 0%,
            rgb(var(--color-border-50)) 40%,
            rgb(var(--color-primary-50) / 0.3) 100%
          );
        }

        .lair-bubbles {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }

        /* Light: watery cyan bubbles */
        .lair-bubble {
          position: absolute;
          border-radius: 50%;
          background: radial-gradient(
            circle at 30% 30%,
            rgb(var(--color-secondary-400) / 0.2),
            rgb(var(--color-secondary-400) / 0.03)
          );
          border: 1px solid rgb(var(--color-secondary-400) / 0.25);
          box-shadow:
            inset 0 -2px 4px rgb(var(--color-secondary-400) / 0.1),
            0 0 6px rgb(var(--color-secondary-400) / 0.06);
          bottom: -30px;
          animation: bubble ease-in infinite;
        }

        /* Dark: purple cosmic bubbles */
        .dark .lair-bubble {
          background: radial-gradient(
            circle at 30% 30%,
            rgb(var(--color-primary-400) / 0.15),
            rgb(var(--color-primary-400) / 0.03)
          );
          border-color: rgb(var(--color-primary-400) / 0.2);
          box-shadow:
            inset 0 -2px 4px rgb(var(--color-primary-400) / 0.08),
            0 0 6px rgb(var(--color-primary-400) / 0.06);
        }

        .lair-content {
          max-width: 600px;
          width: 100%;
          text-align: center;
          position: relative;
          z-index: 1;
          margin: auto 0;
        }

        .lair-mascot {
          position: relative;
          display: inline-block;
          margin-bottom: 1.5rem;
          padding-top: 30px;
          transition: transform 1.5s ease-in-out;
        }

        .lair-hat {
          position: absolute;
          top: -30px;
          left: 58%;
          transform: translateX(-50%) rotate(8deg);
          z-index: 2;
          filter: drop-shadow(0 2px 4px rgb(var(--color-border-300) / 0.5));
        }

        .lair-hat-cone {
          fill: rgb(var(--color-secondary-200));
          stroke: rgb(var(--color-secondary-600));
          stroke-width: 1.5;
        }
        .dark .lair-hat-cone {
          fill: rgb(var(--color-primary-50));
          stroke: rgb(var(--color-primary-400));
        }

        .lair-hat-brim {
          fill: rgb(var(--color-secondary-200));
          stroke: rgb(var(--color-secondary-600));
          stroke-width: 1;
        }
        .dark .lair-hat-brim {
          fill: rgb(var(--color-primary-50));
          stroke: rgb(var(--color-primary-400));
        }

        .lair-hat-star {
          fill: rgb(var(--color-accent-400));
        }

        .lair-logo {
          filter: drop-shadow(0 0 20px rgb(var(--color-primary-400) / 0.5));
        }

        .lair-title-card {
          background: linear-gradient(
            180deg,
            rgb(var(--color-secondary-400) / 0.1) 0%,
            rgb(var(--color-secondary-400) / 0.03) 100%
          );
          border-color: rgb(var(--color-secondary-400) / 0.2);
          backdrop-filter: blur(10px);
          padding: 2rem;
        }
        .dark .lair-title-card {
          background: linear-gradient(
            180deg,
            rgb(var(--color-primary-400) / 0.12) 0%,
            rgb(var(--color-primary-400) / 0.04) 100%
          );
          border-color: rgb(var(--color-primary-400) / 0.2);
        }

        .lair-card {
          background: rgb(var(--color-card) / 0.5);
          border: 1px solid rgb(var(--color-border-200) / 0.5);
          border-radius: 10px;
          padding: 1.25rem;
          margin-bottom: 1.5rem;
          text-align: left;
        }
        .dark .lair-card {
          background: rgb(var(--color-border-50) / 0.5);
          border-color: rgb(var(--color-primary-400) / 0.15);
        }

        .lair-title {
          font-size: 1.6rem;
          color: rgb(var(--color-text-700));
          margin-bottom: 0.75rem;
          letter-spacing: 0.05em;
          text-shadow: 0 0 20px rgb(var(--color-secondary-400) / 0.3);
          line-height: 1.3;
        }
        .dark .lair-title {
          color: rgb(var(--color-primary-700));
          text-shadow: 0 0 20px rgb(var(--color-primary-400) / 0.4);
        }

        .lair-greeting {
          color: rgb(var(--color-text-500));
          font-size: 1rem;
          line-height: 1.7;
          font-style: italic;
          margin: 0;
        }
        .dark .lair-greeting {
          color: rgb(var(--color-primary-600));
        }

        .lair-label {
          color: rgb(var(--color-text-400));
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 0.5rem;
        }
        .dark .lair-label {
          color: rgb(var(--color-text-400));
        }

        .lair-stat {
          color: rgb(var(--color-text-600));
          font-size: 0.95rem;
          margin-bottom: 0.4rem;
        }
        .dark .lair-stat {
          color: rgb(var(--color-primary-600));
        }

        .lair-stat:last-child { margin-bottom: 0; }

        .lair-stat-key {
          color: rgb(var(--color-text-400));
        }
        .dark .lair-stat-key {
          color: rgb(var(--color-text-400));
        }

        .lair-dice {
          font-size: 2.5rem;
          font-weight: bold;
          color: rgb(var(--color-text-700));
          text-shadow: 0 0 15px rgb(var(--color-secondary-400) / 0.3);
        }
        .dark .lair-dice {
          color: rgb(var(--color-primary-700));
          text-shadow: 0 0 15px rgb(var(--color-primary-400) / 0.4);
        }

        .lair-dice-crit {
          color: rgb(var(--color-accent-400)) !important;
          text-shadow: 0 0 20px rgb(var(--color-accent-400) / 0.6) !important;
        }

        .lair-dice-fail {
          color: rgb(var(--color-destructive)) !important;
          text-shadow: 0 0 20px rgb(var(--color-destructive) / 0.4) !important;
        }

        .lair-room-link {
          display: block;
          padding: 0.75rem 1rem;
          background: rgb(var(--color-secondary-400) / 0.06);
          border: 1px solid rgb(var(--color-border-200) / 0.5);
          border-radius: 8px;
          text-decoration: none;
          transition: all 0.2s;
        }
        .dark .lair-room-link {
          background: rgb(var(--color-primary-400) / 0.06);
          border-color: rgb(var(--color-primary-400) / 0.12);
        }

        .lair-room-link:hover {
          background: rgb(var(--color-secondary-400) / 0.12);
          border-color: rgb(var(--color-secondary-400) / 0.3);
          box-shadow: 0 0 12px rgb(var(--color-secondary-400) / 0.1);
        }
        .dark .lair-room-link:hover {
          background: rgb(var(--color-primary-400) / 0.14);
          border-color: rgb(var(--color-primary-400) / 0.3);
          box-shadow: 0 0 12px rgb(var(--color-primary-400) / 0.1);
        }

        .lair-room-name {
          color: rgb(var(--color-text-600));
          font-size: 0.95rem;
          margin-bottom: 0.15rem;
        }
        .dark .lair-room-name {
          color: rgb(var(--color-primary-600));
        }

        .lair-room-desc {
          color: rgb(var(--color-text-400));
          font-size: 0.8rem;
          font-style: italic;
        }
        .dark .lair-room-desc {
          color: rgb(var(--color-text-400));
        }

        .lair-footer {
          color: rgb(var(--color-text-300));
          font-size: 0.75rem;
          font-style: italic;
          margin: 0;
        }
        .dark .lair-footer {
          color: rgb(var(--color-text-300));
        }

        @keyframes bubble {
          0% { transform: translateY(0) scale(1); opacity: 0; }
          10% { opacity: 0.7; }
          80% { opacity: 0.4; }
          100% { transform: translateY(-105vh) scale(0.6); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
