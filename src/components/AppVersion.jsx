import React from 'react';

const PROJECT_URL = 'https://github.com/Kelcoin/Readoshi';

export default function AppVersion({ compact = false }) {
  return (
    <div className={`app-version-link${compact ? ' is-compact' : ''}`}>
      <span>{__APP_VERSION__}</span>
      <a href={PROJECT_URL} target="_blank" rel="noreferrer">GitHub</a>
    </div>
  );
}
