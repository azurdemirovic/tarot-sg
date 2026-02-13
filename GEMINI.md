# GEMINI.md

This file provides a comprehensive overview of the Tarot Slot Game project for Gemini.

## Project Overview

This project is a browser-based 5x3 Tarot-themed slot machine prototype. It is built with **PixiJS 8**, **TypeScript**, and **Vite**. The project is designed as a portfolio piece to demonstrate game logic, animation systems, and clean architecture. The game features a 5x3 symbol grid, a deterministic RNG for spins, a payline evaluation system with WILD substitution, and a sophisticated animation system for reel spinning and feedback.

The project is well-structured, with a clear separation of concerns between game logic, rendering, and configuration. Configuration data for symbols, paytables, and paylines are stored in external files (`symbols.json`, `paytable.json`, and `paylines.ts` respectively), making the game data-driven and easy to modify.

## Building and Running

To get the project running, follow these steps:

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Run the development server:**
    ```bash
    npm run dev
    ```

3.  **Access the game:**
    Open `http://localhost:5173` in your browser.

## Development Conventions

*   **Technology Stack:** The project uses PixiJS for rendering, TypeScript for type-safe code, and Vite for the build system.
*   **Code Structure:** The main application logic is located in the `src` directory.
    *   `main.ts`: The entry point of the application, responsible for setting up the game and handling the main game loop.
    *   `game/`: Contains the core game logic, separated into:
        *   `config/`: Data-driven configuration for symbols, paytables, and paylines.
        *   `logic/`: Core game mechanics like spin generation and payline evaluation.
        *   `render/`: Visual components and rendering logic, such as the grid view, reel spinner, and payline overlays.
*   **State Management:** The game uses a state machine to manage the game's state (e.g., IDLE, SPINNING, COMPLETING).
*   **Asset Management:** Game assets like images and fonts are located in the `public/assets` directory. The `AssetLoader.ts` class is responsible for loading these assets.
*   **Modularity:** The codebase is modular, with clear boundaries between different components. This makes the code easier to understand, maintain, and extend.

## Key Files

*   `README.md`: Provides a detailed overview of the project, including implemented features, planned features, and the technical stack.
*   `package.json`: Defines the project's dependencies and scripts.
*   `vite.config.ts`: Configuration file for the Vite build tool.
*   `src/main.ts`: The main entry point of the application.
*   `src/game/GameController.ts`: The central controller for the game, managing the game state and flow.
*   `src/game/config/paylines.ts`: Defines the 25 fixed paylines using an ASCII-art-like notation.
*   `src/game/config/paytable.json`: Contains the payout multipliers for symbol combinations.
*   `src/game/config/symbols.json`: Defines the symbols used in the game and their properties.
