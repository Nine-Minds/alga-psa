# What is the point of the standard statuses?

## Wouldn't it be better to have a is_standard_status column on the statuses table?

The reason we do this is so that in the future, we can have a template system the standard statuses might be different for different projects. For example, projects related to a medical client might have different standard statuses than projects related to a non-medical client. Having this structure in place will make it easier to implement this in the future.