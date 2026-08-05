"use client";

import { useCallback, useEffect, useState } from "react";

function Verdict({ score, total }) {
  const pct = total ? score / total : 0;
  if (pct === 1) return "Perfect. Suspicious, even.";
  if (pct >= 0.8) return "You know these cats.";
  if (pct >= 0.6) return "Better than a coin flip.";
  if (pct > 0.4) return "About what a coin flip would get you.";
  return "Worse than guessing. Impressive in its own way.";
}

export default function JohnnyOrStevieGame() {
  const [phase, setPhase] = useState("intro"); // intro | playing | scoring | results
  const [questions, setQuestions] = useState([]);
  const [available, setAvailable] = useState(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [outcome, setOutcome] = useState(null);
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
    setAnswers([]);
    setIndex(0);
    setOutcome(null);
    setPhase("playing");
  }

  async function answer(guess) {
    const next = [...answers, { id: questions[index].id, guess }];
    setAnswers(next);

    if (index + 1 < questions.length) {
      setIndex(index + 1);
      return;
    }

    setPhase("scoring");
    try {
      const res = await fetch("/api/game/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error();
      setOutcome(json);
      setPhase("results");
    } catch {
      setError("Couldn't score that round.");
      setPhase("intro");
    }
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

  if (phase === "playing" || phase === "scoring") {
    const q = questions[index];
    const scoring = phase === "scoring";
    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-sm uppercase tracking-widest text-gray-500">
            {index + 1} of {questions.length}
          </p>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-espn transition-all"
              style={{
                width: `${((index + (scoring ? 1 : 0)) / questions.length) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={q.url}
          alt="Which cat is this?"
          className="mx-auto max-h-[60vh] w-full rounded-md border border-gray-200 bg-gray-100 object-contain"
        />

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={scoring}
            onClick={() => answer("johnny")}
            className="rounded-md bg-nav px-6 py-5 font-display text-xl uppercase tracking-widest text-white transition-colors hover:bg-espn disabled:opacity-50"
          >
            Johnny
          </button>
          <button
            type="button"
            disabled={scoring}
            onClick={() => answer("stevie")}
            className="rounded-md bg-nav px-6 py-5 font-display text-xl uppercase tracking-widest text-white transition-colors hover:bg-espn disabled:opacity-50"
          >
            Stevie
          </button>
        </div>
        {scoring && (
          <p className="mt-4 text-center text-sm text-gray-500">
            Scoring...
          </p>
        )}
      </div>
    );
  }

  // results
  return (
    <div>
      <div className="rounded-md bg-nav px-6 py-10 text-center">
        <p className="font-display text-xs uppercase tracking-widest text-gray-400">
          Final Score
        </p>
        <p className="mt-2 font-display text-6xl font-semibold text-white">
          {outcome.score}
          <span className="text-3xl text-gray-400">/{outcome.total}</span>
        </p>
        <p className="mt-3 text-gray-300">
          <Verdict score={outcome.score} total={outcome.total} />
        </p>
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
        {outcome.results.map((r, i) => (
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
                {r.actual === "johnny" ? "Johnny" : "Stevie"}
              </p>
              {!r.correct && (
                <p className="text-[11px] text-gray-500">
                  you said {r.guess === "johnny" ? "Johnny" : "Stevie"}
                </p>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
