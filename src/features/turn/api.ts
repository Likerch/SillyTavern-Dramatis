// What the turn module offers the other modules (`app.modules.api<TurnApi>(TURN_API)`, present while it runs).
export const TURN_API = 'turn';

export interface TurnApi {
    /**
     * Brings the committed turn up to date for the generation that starts now: the reply before the last user message
     * is committed from its ready draft when Maestro's `turn:committed` has not reached this module yet (no AI here —
     * a reply whose pass is still running is left to it), then every commit in progress is awaited.
     */
    settle(): Promise<void>;
}
