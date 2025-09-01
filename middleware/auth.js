export const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    } else {
        const error = new Error("Unauthorised");
        error.status = 401;
        next(error);
    }
};