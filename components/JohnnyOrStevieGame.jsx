"use client";

import { useCallback, useEffect, useState } from "react";

const FEEDBACK_MS = 1200;

function verdict(score, total) {
  const pct = total ? score / total : 0;
  if (pct === 1) return "Perfect. Suspicious, even.";
  if (pct >= 0.8) return "You know these cats.";
  if (pct >= 0.6) return "Better than a coin flip.";
  if (pct > 0.4) return "About what a coin flip would get you.";
  return "Worse than guessing. Impressive in its own way.";
}

function label(cat) {
  return cat === "johnny" ? "Johnny" : "Stevie";
}

export default function JohnnyOrStevieGame() {
  const [phase, setPhase] = useState("intro"); // intro | playing | results
  const [questions, setQuestions] = useState([]);
  const [available, setAvailable] = useState(null);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState([]);
  const [feedback, setFeedback] = useState(null); // {correct, actual, guess}
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const loadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/game/round");
      const json = await res.json();
      setAvailable(json.available ?? 0);
    } catch {
      setAvailable(0);
    }
  }, []);

  useEffect(() => {
    loadCount();
  }, [loadCount]);

  async function start() {
    setError("");
    let res, json;
    try {
      res = await fetch("/api/game/round");
      json = await res.json();
    } catch {
      setError("Couldn't load the game. Try again.");
      return;
    }
    if (!res.ok || !json.questions?.length) {
      setError("No photos loaded yet.");
      return;
    }
    setQuestions(json.questions);
    setResults([]);
    setIndex(0);
    setFeedback(null);
    setPhase("playing");
  }

  async function answer(guess) {
    if (checking || feedback) return; // ignore double taps
    setChecking(true);
    setError("");

    // Grade this one question on the server. Sending a single answer keeps the
    // correct label out of the browser until the moment it's revealed.
    let result;
    try {
      const res = await fetch("/api/game/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: [{ id: questions[index].id, guess }],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error();
      result = json.results[0];
    } catch {
      setChecking(false);
      setError("Couldn't check that one. Tap again.");
      return;
    }

    const nextResults = [...results, result];
    setResults(nextResults);
    setFeedback(result);
    setChecking(false);

    setTimeout(() => {
      setFeedback(null);
      if (index + 1 < questions.length) {
        setIndex(index + 1);
      } else {
        setPhase("results");
      }
    }, FEEDBACK_MS);
  }

  if (phase === "intro") {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 px-6 py-12 text-center">
        <h2 className="font-display text-2xl font-semibold uppercase tracking-wide text-gray-900">
          Two black cats. One question.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-gray-600">
          You&apos;ll get {available !== null && available < 20 ? available : 20}{" "}
          photos. Say whether each one is Johnny or Stevie. Score at the end.
        </p>
        {available === 0 ? (
          <p className="mt-6 text-sm text-gray-500">
            No photos have been added yet.
          </p>
        ) : (
          <button
            type="button"
            onClick={start}
            className="mt-6 rounded-md bg-espn px-10 py-3 font-display text-base uppercase tracking-widest text-white transition-colors hover:bg-espn-dark"
          >
            Start
          </button>
        )}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (phase === "playing") {
    const q = questions[index];
    const locked = Boolean(feedback) || checking;

    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-sm uppercase tracking-widest text-gray-500">
            {index + 1} of {questions.length}
          </p>
          <p className="font-display text-sm uppercase tracking-widest text-gray-500">
            {results.filter((r) => r.correct).length} correct
          </p>
        </div>

        <div className="relative overflow-hidden rounded-md border border-gray-200 bg-gray-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={q.url}
            alt="Which cat is this?"
            className="mx-auto max-h-[55vh] w-full object-contain"
          />

          {feedback && (
            <div
              className={`absolute inset-0 flex flex-col items-center justify-center ${
                feedback.correct ? "bg-green-600/85" : "bg-red-600/85"
              }`}
            >
              <p className="font-display text-4xl font-semibold uppercase tracking-widest text-white sm:text-5xl">
                {feedback.correct ? "Correct" : "Nope"}
              </p>
              <p className="mt-2 font-display text-lg uppercase tracking-widest text-white/90">
                That&apos;s {label(feedback.actual)}
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {["johnny", "stevie"].map((c) => (
            <button
              key={c}
              type="button"
              disabled={locked}
              onClick={() => answer(c)}
              className={`rounded-md px-6 py-5 font-display text-xl uppercase tracking-widest text-white transition-colors disabled:cursor-default ${
                feedback && feedback.guess === c
                  ? feedback.correct
                    ? "bg-green-600"
                    : "bg-red-600"
                  : "bg-nav hover:bg-espn disabled:opacity-40"
              }`}
            >
              {label(c)}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-3 text-center text-sm text-red-600">{error}</p>
        )}
      </div>
    );
  }

  // results
  const score = results.filter((r) => r.correct).length;
  const total = results.length;

  return (
    <div>
      <div className="rounded-md bg-nav px-6 py-10 text-center">
        <p className="font-display text-xs uppercase tracking-widest text-gray-400">
          Final Score
        </p>
        <p className="mt-2 font-display text-6xl font-semibold text-white">
          {score}
          <span className="text-3xl text-gray-400">/{total}</span>
        </p>
        <p className="mt-3 text-gray-300">{verdict(score, total)}</p>
        <button
          type="button"
          onClick={start}
          className="mt-6 rounded-md bg-espn px-8 py-3 font-display text-sm uppercase tracking-widest text-white transition-colors hover:bg-espn-dark"
        >
          Play Again
        </button>
      </div>

      <h3 className="mb-4 mt-10 border-b-2 border-espn pb-2 font-display text-xl font-semibold uppercase tracking-wide text-gray-900">
        The Answers
      </h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {results.map((r, i) => (
          <figure
            key={r.id || i}
            className={`overflow-hidden rounded-md border-2 ${
              r.correct ? "border-green-500" : "border-red-500"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={r.url}
              alt=""
              loading="lazy"
              className="aspect-square w-full bg-gray-100 object-cover"
            />
            <figcaption className="px-2 py-2 text-center">
              <p
                className={`font-display text-sm uppercase tracking-widest ${
                  r.correct ? "text-green-700" : "text-red-600"
                }`}
              >
                {label(r.actual)}
              </p>
              {!r.correct && (
                <p className="text-[11px] text-gray-500">
                  you said {label(r.guess)}
                </p>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
