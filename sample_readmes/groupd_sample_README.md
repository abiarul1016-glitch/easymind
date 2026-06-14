# group'd

A better group generator—still random, but customized.

---

[![meet group'd](https://img.youtube.com/vi/Smu0lYzUtLI/maxresdefault.jpg)](https://www.youtube.com/watch?v=Smu0lYzUtLI)

</div>

## 🏆 Achievements

> [!IMPORTANT]
> **MathHacks 3rd Place Winner**  
> Recognized for its unique approach to balanced randomization and user-friendly interface.

---

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

## What is it?

Teachers spend way too much time manually splitting students into groups — trying to remember who works well together, who absolutely shouldn't be paired, and making sure groups are balanced. **group'd** automates all of that.

Paste your class list, define your constraints, and the algorithm runs 5,000 iterations to find the optimal arrangement in seconds.

## Features

- **Constraint-aware grouping** — specify pairs who work well together or should be kept apart
- **Optimisation algorithm** — scores every random arrangement and keeps the best one
- **Cryptex animation** — satisfying lock-cracking animation while groups are generated
- **Early exit** — algorithm stops immediately when a perfect score of 0 is reached
- **Responsive UI** — works on desktop and mobile

## How it works

The core is a randomised optimisation algorithm:

1. Shuffle the student list randomly
2. Distribute students across groups using round-robin assignment (`student index % num_groups`)
3. Score the arrangement — `+10` for every "together" pair that was split, `+50` for every "not together" pair that ended up in the same group
4. Repeat 5,000 times, keeping the lowest-scoring result
5. Return the best arrangement found

The scoring intentionally punishes "not together" violations more harshly (50 vs 10), since keeping conflicting students apart is more important than guaranteeing preferred pairings.

## Tech stack

The algorithm was originally written in Python and later ported to JavaScript so the app runs entirely in the browser — no backend or server needed.

| Layer        | Technology                              |
| ------------ | --------------------------------------- |
| UI framework | React (Vite)                            |
| Styling      | Inline CSS with CSS keyframe animations |
| Algorithm    | Vanilla JavaScript (ported from Python) |

## Running locally

```bash
# Clone the repo
git clone https://github.com/yourusername/groupd-app.git
cd groupd-app

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Then open `http://localhost:5173` in your browser.

## Original Python version

The algorithm was first built as a CLI tool in Python. You can still run it directly:

```bash
python groupd.py students.txt
```

Where `students.txt` is a plain text file with one student name per line.

## What's next

- [ ] Save and export group results as PDF
- [ ] Teacher accounts with class rosters
- [ ] Session history — view past group arrangements
- [ ] Flask backend option for persistent storage

---

<div align="center">

Built at MathHacks &nbsp;·&nbsp; Made with 🟢 and a lot of `random.shuffle()`

</div>
