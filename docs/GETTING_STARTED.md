# Getting started with RepForge

This guide takes you from a fresh clone to logging your first workout on your phone, then walks through the app. It takes about 15 minutes, most of it Docker building the first time.

You run the backend on your computer and open the app on your phone with Expo Go.

## What you need

- **Docker Desktop**, installed and running
- **Node 24 or newer**, and pnpm: run `corepack enable pnpm`
- **Python 3.12**: with pyenv, run `pyenv install 3.12.3`
- **Make** and **Git** (already on macOS and Linux; on Windows, run everything inside WSL)
- **Expo Go** on your phone, the latest version from the App Store or Google Play
- Your phone and computer on the **same Wi-Fi**

The backend itself runs in Docker. Python is for the local tools: linting, tests and new migrations.

## 1. Get the code

```bash
git clone https://github.com/vamshi-987/repforge-ai-fitness-tracker.git
cd repforge-ai-fitness-tracker
```

## 2. Install everything

```bash
make setup
```

This creates `.env` and `mobile/.env.local`, creates the Python virtual environment in `backend/.venv`, and installs the backend and mobile dependencies. Nothing is installed globally, and it's safe to run again.

## 3. Start the backend

```bash
make up        # builds and starts the API, workers, database, Redis and storage
make migrate   # creates the database tables
make seed      # loads 422 exercises and the starter foods
```

The first `make up` takes a few minutes. Check it worked:

```bash
curl localhost:8010/v1/health
```

You should see `{"status":"ok","version":"0.1.0"}`.

## 4. Point the app at your computer

Your phone can't reach `localhost` on your computer, so the app needs your computer's address on the Wi-Fi network.

Find your address:

| System | Command |
|---|---|
| macOS | `ipconfig getifaddr en0` |
| Linux | `hostname -I` |
| Windows | `ipconfig`, then look for IPv4 Address |

Open `mobile/.env.local` and put it in, keeping port 8010:

```bash
EXPO_PUBLIC_API_URL=http://192.168.0.121:8010
```

## 5. Start the app

```bash
make mobile-start
```

A QR code appears in the terminal. Scan it with the Camera app on iPhone, or from inside Expo Go on Android. The first load takes a minute.

## 6. Create your account

1. Tap **Create an account** and sign up with an email and a password of at least 8 characters. Any real-looking address works locally, because nothing is sent to it.
2. Answer the 8 onboarding questions: units, sex, birth date, height, weight, activity, goal and experience. They set your calorie and water targets.
3. You land on **Home**.

If Home shows a green **API connected** badge, you're done.

## Using the app

### Log a workout
1. Open the **Workout** tab and tap **Start empty workout**.
2. Tap **Add exercises**, pick some, and add them.
3. Enter the weight and reps for each set, then tick it. The rest timer starts by itself. Tap **Plates** beside an exercise to see what to load on the bar for your next set.
4. Tap **Finish workout**, choose who can see it, and tap **Save workout**.

This works with no connection at all: workouts save on your phone and sync when you're back online. Personal records appear on the summary.

To repeat a session, tap **New routine** on the Workout tab, then start it from there. Each set shows what you did last time.

### Track food
1. Open the **Nutrition** tab and tap **Add food**.
2. Find the food under **Search**, **Barcode**, **Recent** or **Saved**.
3. Set the amount and add it. It counts towards the day's total, so there's no meal to choose. You can edit any number: change the protein and the calories recompute.

Logged the wrong thing? Tap **Remove** beside it, or tap the food to change its amount. Use **Create a food** for anything missing. The **⋯** menu on **Food logged** copies the day's food to another day or saves it to log again in one tap.

To plan your day, tap **+** on **Meal plan** and add a name and a time, like "Breakfast" at 8:30. Tap a meal to change or remove it. The plan is only there to plan around: food you log isn't tied to it.

To change your calorie and macro goals, tap **Edit daily targets** on the **Nutrition** tab. New targets start today, and calories can't go below your safe minimum.

### Track water
On **Home**, tap the water card, then tap a cup to add it. Long-press a cup to change its size. Tap **Change daily goal** to set your own goal, and **Use recommended goal** to go back. Turn reminders on in **Settings**.

### Track your body
**Profile → Body** logs your weight, measurements and progress photos. Log three weigh-ins in a week to see the weekly average.

### See your progress
The **Profile** tab shows your stats and a muscle map. From there, **Workout history** and **Calendar** show past sessions, and **Tools** has plate, 1RM and warm-up calculators. Open any exercise for its charts and records.

### Train with friends
**Profile → Find people** finds and follows others, and their shared workouts appear on **Home**, where you can like and comment. To try it alone, create a second account. **Settings → Private profile** means you approve each follower. In **Workout history**, open a workout and tap **Share workout** to share it as an image.

### Your data
**Settings → Your data** exports everything, imports workouts from a CSV, or deletes your account.

## Optional extras

### Food photos and typed meals
These use Claude, so they need an API key from [platform.claude.com](https://platform.claude.com). Add it to `.env`, then run `make up`:

```bash
ANTHROPIC_API_KEY=your-key
```

Then use the **Photo** and **Text** tabs when adding food. You check every item before it's logged. Without a key, the app asks you to add food by hand. Calls to Claude cost a small amount on your Anthropic account.

### Pro features
The weekly report, overload targets, unlimited routines and long-range charts are Pro. Locally, turn Pro on by hand, using the email you signed up with:

```bash
docker compose exec postgres psql -U repforge -d repforge \
  -c "update users set is_pro = true where email = 'you@example.com'"
```

Then close and reopen the app.

- **Weekly report:** Nutrition → **Weekly report**. It needs three weigh-ins in each of the last two full weeks. Nothing changes until you tap **Apply new targets**.
- **Overload targets:** finish a workout from a routine, then start that routine again. Each set shows a target like "Try 62.5 kg × 8".

### Better food search
Search works with a shared USDA key that's limited to 30 requests an hour. For more, get a free key at [fdc.nal.usda.gov](https://fdc.nal.usda.gov/api-key-signup), set `USDA_FDC_API_KEY` in `.env`, and run `make up`.

## What won't work in Expo Go

Apple Health, Health Connect, push notifications and subscriptions need a development build, which needs an Expo account. Everything else in this guide works in Expo Go. The app says so in those places rather than failing.

## Starting and stopping

```bash
make up            # start the backend
make mobile-start  # start the app
make down          # stop the backend; your data is kept
```

After pulling new code, run `make setup`, `make up`, `make migrate` and `make seed`. All four are safe to repeat.

To wipe everything and start again: `make nuke && make up && make migrate && make seed`. This deletes your local data.

## If something goes wrong

| What you see | What to do |
|---|---|
| `make setup` says Python 3.12 is required | Run `pyenv install 3.12.3`, or point it at your copy: `make setup PYTHON=/path/to/python3.12`. |
| "API unreachable" in the app | Check the phone is on the same Wi-Fi and the address in `mobile/.env.local` is right. Open `http://<your-address>:8010/v1/health` in the phone's browser. If it won't load, your computer's firewall may be blocking port 8010. After changing the address, stop the app and run `cd mobile && pnpm start --go --clear`. |
| `make up` says a port is already allocated | Another program is using it. Change `API_PORT`, `POSTGRES_PORT`, `REDIS_PORT` or `S3_PORT` in `.env`. If you change `API_PORT`, change `mobile/.env.local` too. |
| The QR code opens the wrong thing, or nothing | Start with `make mobile-start`, which targets Expo Go. On Android, scan from inside Expo Go. |
| Expo Go says the SDK isn't supported | Update Expo Go from the store. The app uses Expo SDK 58. |
| "Too many attempts" when logging in | Wait 15 minutes, or clear it: `docker compose exec redis sh -c "redis-cli --scan --pattern 'rl:login:*' \| xargs -r redis-cli DEL"` |
| Exercises or foods are missing | Run `make seed`. |
| Progress photos won't upload from your phone | Set `S3_PUBLIC_URL=http://<your-address>:9010` in `.env` and run `make up`. |
| Anything else in the backend | `make ps` shows what's unhealthy, and `make logs` shows why. |

## Next

- [RUNBOOK.md](RUNBOOK.md): what to run after each kind of code change, and more troubleshooting
- [api.md](api.md): every API endpoint
- [architecture.md](architecture.md): how the pieces fit together

Nutrition and coaching numbers are estimates only, not medical advice.
