/**
 * Mock Courier API Simulation
 */
export const fetchCourierTracking = async (trackingId, carrier, shippedAt) => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 800));

    // Simulate invalid tracking ID
    if (!trackingId || trackingId.toUpperCase() === "INVALID") {
        const error = new Error("Invalid tracking ID provided.");
        error.statusCode = 400;
        throw error;
    }

    // Simulate intermittent API failure
    if (Math.random() < 0.05) { // 5% chance of failure
        const error = new Error("Courier API is currently unavailable. Please try again later.");
        error.statusCode = 503;
        throw error;
    }

    // Generate pseudo-random consistent variations based on tracking ID
    const seed = trackingId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    const CITIES = ["Karachi", "Lahore", "Islamabad", "Multan", "Faisalabad", "Rawalpindi", "Peshawar", "Quetta"];
    const origin = CITIES[seed % CITIES.length];
    const destination = CITIES[(seed * 3) % CITIES.length];
    
    // Always different but consistent across different tracking IDs
    const statuses = [
        { status: "shipped", description: "Package has left the facility.", location: `${origin} Main Hub` },
        { status: "in_transit", description: "Package is on its way to the destination.", location: `Regional Hub, ${origin}` },
        { status: "in_transit", description: "Moving through network.", location: "National Sorting Center" },
        { status: "in_transit", description: "Arrived at local distribution center.", location: `${destination} Terminal` },
        { status: "out_for_delivery", description: "Courier is out for delivery.", location: `Local Branch, ${destination}` },
        { status: "delivered", description: "Package delivered and signed for.", location: `Destination Address` }
    ];

    const maxSteps = statuses.length;
    let progressCount = Math.floor((Date.now() - new Date(shippedAt).getTime()) / (1000 * 25)); // 1 step every 25 seconds for demo
    if (progressCount < 1) progressCount = 1;
    if (progressCount > maxSteps) progressCount = maxSteps;
    
    return statuses.slice(0, progressCount).map((s, idx) => ({
        ...s,
        timestamp: new Date(new Date(shippedAt).getTime() + (idx * 1000 * 25)) // True to the demo progress speed
    }));
};
