/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            animation: {
                'in-from-bottom': 'in-from-bottom 0.3s ease-out',
                'in-from-right': 'in-from-right 0.3s ease-out',
            },
            keyframes: {
                'in-from-bottom': {
                    '0%': { transform: 'translateY(10px)', opacity: 0 },
                    '100%': { transform: 'translateY(0)', opacity: 1 },
                },
                'in-from-right': {
                    '0%': { transform: 'translateX(20px)', opacity: 0 },
                    '100%': { transform: 'translateX(0)', opacity: 1 },
                },
            }
        },
    },
    plugins: [],
}
