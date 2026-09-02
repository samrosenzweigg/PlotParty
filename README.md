# Bingo Bango

A party game shell that hosts mini games. Everyone joins one room with a name and
a photo, the host picks a game (or opens it to a vote), and scores carry across
every game played that night. Plot Party is the first mini game.

## Files

Everything sits in the repo root so it can be uploaded one file at a time from
Safari on an iPad.

| File | What it owns |
| --- | --- |
| `server.js` | Rooms, players, identity, avatars, host succession, voting, the running scoreboard |
| `index.html` | The shell client: join, avatar capture, lobby, game picker, scores, banners |
| `game-plotparty.js` | Plot Party's server logic and secret filtering |
| `client-plotparty.js` | Plot Party's screen |
| `package.json` | Deps and the start script |

## Running it

```
npm install
npm start
```

On Render: build `npm install`, start `npm start`. The server reads `PORT` from
the environment. Rooms live in memory only, so a redeploy clears every game in
progress — that is the free tier working as intended, not a bug.

## How a mini game plugs in

A game is two files and two lines of registration. It never touches a socket;
the shell owns the wire and passes messages through one channel.

**Server side** — `game-<id>.js` exports a module and a `create(ctx)`:

```js
module.exports = {
  id: 'yourgame',
  name: 'Your Game',
  tagline: 'One line for the lobby card.',
  minPlayers: 2,
  create(ctx) {
    return {
      viewFor(playerId) { return { /* what this player is allowed to see */ }; },
      onEvent(playerId, type, payload) { },
      onJoin(playerId) { },
      onLeave(playerId) { },
      dispose() { },
    };
  },
};
```

`ctx` gives you `players`, `hostId`, `push()`, `banner(text, tone)` and
`finish(scores)`. Call `finish({playerId: points})` to end the game — the shell
adds those points to the running totals and shows the scoreboard.

`viewFor` is where secrets stay secret. It runs once per player per push, so
hide the answer from everyone who is not meant to have it there, not on the
client.

**Client side** — `client-<id>.js` registers itself:

```js
window.BingoBango.registerGame({
  id: 'yourgame',
  mount(container, api) { },     // build the DOM once
  render(view, api) { },          // called on every state push
  unmount() { },                  // clean up timers and overlays
});
```

`api` gives you `send(type, payload)`, `me`, `players`, `player(id)`, `isHost`,
`banner()`, `faceEl(player)` for avatar bubbles, and `serverNow()` for clocks.

**Registration** — add one line to `GAME_MODULES` and one to `CLIENT_FILES` in
`server.js`. Nothing else changes. The lobby card, the vote and the scoreboard
all pick it up.

## Things that will bite you again

- **`[hidden]` loses to `display: flex`.** The shell sets
  `[hidden] { display: none !important; }` globally. Leave it there.
- **iOS suspends timers in background tabs.** Every countdown is sent as a
  server timestamp and recomputed each tick from `api.serverNow()`, so a tab
  that wakes up late catches up instead of finishing late. Do the same in any
  new game rather than counting down locally.
- **Banners are a top bar, never a full-screen scrim,** and a watchdog clears
  them. A scrim that gets stuck locks the whole game out.
- **Safari drops large data URLs silently.** The tile export goes through
  `canvas.toBlob` and an object URL.
- **Avatars never touch disk.** Render's free tier has no persistent storage, so
  photos are cropped to 128px and re-compressed until they are under 40KB, then
  held in room memory and dropped when the room is swept.
- **Players reconnect constantly.** Each device keeps a token in
  `localStorage`; the server seats a returning token back into the same player
  rather than creating a ghost. Assume any player can vanish and return
  mid-round.

## Plot Party

Three modes, set by the host from the cog in the top bar:

- **Live** — every dot moves in real time. No secrets, lots of arguing.
- **Countdown** — place in secret against the clock, then everything drops at once.
- **Clue giver** — the grid picks a secret spot, one player names something that
  belongs there, everyone else guesses. Points by distance, and the clue giver
  scores the average of everyone they managed to steer.

Only Clue giver awards points, so a night of Live and Countdown ends at nil all.
The board keeps the average of every round with its label until the host clears
it, and the reveal screen can export the whole board as an image.
