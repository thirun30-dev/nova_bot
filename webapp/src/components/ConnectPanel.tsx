"use client";

// Shown when the page is hosted away from the robot (Vercel): nothing talks to the robot until
// the user enters its address + token and presses Connect. Phone/laptop and robot must be on
// the same Wi-Fi. An https page can only reach the robot's https port (8443), whose
// self-signed certificate the browser must accept once.

import { useState } from "react";
import { robotOrigin, savedConnection } from "@/lib/api";
import { useRobot } from "./RobotProvider";
import { Button, Card } from "./ui";

type Problem = { kind: "address" | "token" | "unreachable"; origin?: string } | null;

export default function ConnectPanel() {
  const { connect } = useRobot();
  // only rendered in the browser (after the page knows it is not served by the robot)
  const [address, setAddress] = useState(() => savedConnection().address);
  const [token, setToken] = useState(() => savedConnection().token);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);

  const preview = robotOrigin(address);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    const r = await connect(address, token.trim());
    setBusy(false);
    if (!r.ok) setProblem({ kind: r.reason, origin: r.origin });
  };

  const input =
    "w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:border-accent focus:outline-none";

  return (
    <div className="mx-auto mt-6 max-w-lg">
      <Card title="Connect to robot">
        <form onSubmit={submit} className="space-y-4">
          <p className="text-slate-400">
            Join the same Wi-Fi as the robot, then enter its IP address and access token. The robot
            prints both when it starts (<code className="text-slate-300">~/nova_run.log</code>).
          </p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Robot address</span>
            <input className={input} value={address} onChange={(e) => setAddress(e.target.value)}
              placeholder="192.168.1.50" autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode="url" />
            {preview && <span className="block text-xs text-slate-500">Connects to {preview}</span>}
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Access token</span>
            <input className={input} value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="from ~/.config/nova/token" autoComplete="off" autoCapitalize="off" spellCheck={false} />
          </label>
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !address.trim()}>
            {busy ? "Connecting…" : "Connect"}
          </Button>

          {problem?.kind === "address" && <Note>That doesn&apos;t look like an address. Use e.g. 192.168.1.50 or nova.local.</Note>}
          {problem?.kind === "token" && <Note>The robot answered but rejected the token. Check it and try again.</Note>}
          {problem?.kind === "unreachable" && (
            <Note>
              <p>Couldn&apos;t reach {problem.origin}.</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {problem.origin?.startsWith("https:") && (
                  <li>
                    First time on this device? Open{" "}
                    <a href={`${problem.origin}/api/state`} target="_blank" rel="noreferrer" className="font-medium text-accent-2 underline">
                      {problem.origin}
                    </a>{" "}
                    and accept the security warning (Advanced → Proceed). The robot uses its own
                    certificate. Then come back and press Connect.
                  </li>
                )}
                <li>Check that this device is on the same Wi-Fi as the robot and the IP is current.</li>
                <li>Check that the robot is running (<code>~/start_mapping.sh</code>).</li>
              </ul>
            </Note>
          )}
        </form>
      </Card>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-2.5 text-amber-100">{children}</div>;
}
