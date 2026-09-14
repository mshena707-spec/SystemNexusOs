import React, { useState, useEffect } from 'react';

// Cache completed strings in memory so they don't restream on unmount/remount
const completedCache = new Set<string>();

export function TypewriterText({ text, speed = 10, isStreaming = true }: { text: string, speed?: number, isStreaming?: boolean }) {
  const [displayedText, setDisplayedText] = useState(completedCache.has(text) ? text : '');
  const [hasCompleted, setHasCompleted] = useState(completedCache.has(text));

  useEffect(() => {
    if (!isStreaming || hasCompleted || completedCache.has(text)) {
       setDisplayedText(text);
       return;
    }

    let index = displayedText.length;
    const intervalId = setInterval(() => {
      index += Math.floor(Math.random() * 3) + 1; // 1-3 chars at a time
      if (index >= text.length) {
        index = text.length;
        clearInterval(intervalId);
        setHasCompleted(true);
        completedCache.add(text);
      }
      setDisplayedText(text.slice(0, index));
    }, speed);

    return () => clearInterval(intervalId);
  }, [text, speed, isStreaming, hasCompleted]);

  return <span>{displayedText}</span>;
}
