# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: login.spec.js >> student login test
- Location: tests\login.spec.js:3:1

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - generic [ref=e4]:
      - link "Flash Foods" [ref=e6] [cursor=pointer]:
        - /url: /
      - navigation "Main" [ref=e7]:
        - link "Canteens" [ref=e8] [cursor=pointer]:
          - /url: /shops
        - link "Cart" [ref=e9] [cursor=pointer]:
          - /url: /cart
        - link "Orders" [ref=e10] [cursor=pointer]:
          - /url: /orders
        - generic [ref=e11]: Hi, Shubham Kotak
        - button "Logout" [ref=e13] [cursor=pointer]
  - main [ref=e14]:
    - generic [ref=e15]: Logged in.
    - generic [ref=e17]:
      - text: Campus food, faster
      - heading "Skip the Queue." [level=1] [ref=e18]
      - paragraph [ref=e19]: Order before break. Pick up instantly.
      - generic [ref=e20]:
        - paragraph [ref=e21]:
          - text: You are logged in as
          - strong [ref=e22]: student
          - text: .
        - paragraph [ref=e23]: Browse canteens, add items to your cart, and place an order to get a pickup code.
        - generic [ref=e24]:
          - link "Browse canteens" [ref=e25] [cursor=pointer]:
            - /url: /shops
          - link "My orders" [ref=e26] [cursor=pointer]:
            - /url: /orders
    - region "Fast Food benefits" [ref=e27]:
      - article [ref=e28]:
        - generic [ref=e29]: "1"
        - heading "Save time" [level=2] [ref=e30]
        - paragraph [ref=e31]: Order before the bell and collect without waiting in line.
      - article [ref=e32]:
        - generic [ref=e33]: "2"
        - heading "Live menu availability" [level=2] [ref=e34]
        - paragraph [ref=e35]: Students see what is available before they add it to cart.
      - article [ref=e36]:
        - generic [ref=e37]: "3"
        - heading "Secure online payment" [level=2] [ref=e38]
        - paragraph [ref=e39]: Simple checkout flow with clear order confirmation.
      - article [ref=e40]:
        - generic [ref=e41]: "4"
        - heading "Instant pickup" [level=2] [ref=e42]
        - paragraph [ref=e43]: Pickup codes help counters complete orders quickly.
  - contentinfo [ref=e44]:
    - paragraph [ref=e46]: © 2026 Flash Foods™ by Shubham Kotak. All rights reserved.
```