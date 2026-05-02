import random

def run_simulation(num_drives=500):
    # Operating cost per mile (IRS standard is $0.67)
    # This covers gas, tires, oil, insurance, and the Pilot's depreciation.
    COST_PER_MILE = 0.67
    REVENUE_PER_MILE = 2.00
    FREE_RADIUS = 10 # Miles
    
    total_miles = 0
    total_cost = 0
    total_revenue = 0
    trips_under_10 = 0
    trips_over_10 = 0
    
    results = []
    
    for _ in range(num_drives):
        # Generate a realistic distance distribution
        # 70% are local (0-10 miles), 20% mid-range (10-20), 10% far (20-35)
        rand = random.random()
        if rand < 0.70:
            miles = random.uniform(2, 10)
            trips_under_10 += 1
        elif rand < 0.90:
            miles = random.uniform(10, 20)
            trips_over_10 += 1
        else:
            miles = random.uniform(20, 35)
            trips_over_10 += 1
            
        # Round trip (Pickup and Dropoff is 4 legs total, but let's assume 2 round trips)
        # One trip to pick up (there and back) = 2x miles
        # One trip to drop off (there and back) = 2x miles
        # Total distance driven per job = 4x miles
        total_job_miles = miles * 4 
        
        # Cost to Matt
        job_cost = total_job_miles * COST_PER_MILE
        
        # Revenue from customer
        billable_miles = max(0, miles - FREE_RADIUS)
        # Charging $2/mile for the billable portion (round trip logic applied to billing)
        job_revenue = billable_miles * REVENUE_PER_MILE * 4 
        
        total_miles += total_job_miles
        total_cost += job_cost
        total_revenue += job_revenue
        
    profit = total_revenue - total_cost
    
    print(f"--- SIMULATION: 500 DRIVES (2011 HONDA PILOT) ---")
    print(f"Total Distance Driven: {total_miles:,.0f} miles")
    print(f"Trips under {FREE_RADIUS} miles (FREE): {trips_under_10}")
    print(f"Trips over {FREE_RADIUS} miles (BILLABLE): {trips_over_10}")
    print(f"------------------------------------------------")
    print(f"Total Operating Cost (Gas/Wear): ${total_cost:,.2f}")
    print(f"Total Transport Revenue:        ${total_revenue:,.2f}")
    print(f"------------------------------------------------")
    print(f"NET PROFIT/LOSS ON TRANSPORT:   ${profit:,.2f}")
    print(f"Average Profit per Job:         ${profit/num_drives:,.2f}")
    
    if profit < 0:
        print("\nWARNING: Matt is LOSING money on every 'Free' trip.")
        print(f"Each 'Free' 8-mile trip actually COSTS Matt about ${8 * 4 * COST_PER_MILE:.2f} in real expenses.")

if __name__ == "__main__":
    run_simulation()
